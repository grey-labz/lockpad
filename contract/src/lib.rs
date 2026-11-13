use near_contract_standards::{
    fungible_token::receiver::FungibleTokenReceiver,
    non_fungible_token::{
        core::{NonFungibleTokenCore, NonFungibleTokenResolver},
        enumeration::NonFungibleTokenEnumeration,
        events::NftMint,
        metadata::{NFTContractMetadata, NonFungibleTokenMetadataProvider, TokenMetadata, NFT_METADATA_SPEC},
        NonFungibleToken, Token, TokenId,
    },
};
use near_sdk::{
    assert_one_yocto, env, ext_contract, json_types::{U128, U64}, near, require,
    serde_json, store::LookupMap, AccountId, Gas, NearToken, PanicOnDefault,
    Promise, PromiseOrValue,
};
use std::collections::HashMap;

const STORAGE: NearToken = NearToken::from_millinear(30);
const ONE: NearToken = NearToken::from_yoctonear(1);
const TRANSFER_STORAGE: NearToken = NearToken::from_millinear(5);
const SECOND: u64 = 1_000_000_000;
const TERMS: [u64; 5] = [60, 300, 604_800, 2_592_000, 7_776_000];

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Status { Active, Redeeming, Redeemed }

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Lock {
    principal: U128,
    created_at: U64,
    unlock_at: U64,
    status: Status,
}

/// The authoritative adapter response. Redeemed NFTs remain as historical receipts.
#[near(serializers = [json])]
pub struct Position {
    adapter_version: String,
    token_id: TokenId,
    owner_id: AccountId,
    asset_id: AccountId,
    principal: U128,
    created_at: U64,
    unlock_at: U64,
    status: Status,
    transfer_pending: bool,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct TransferResult {
    token_id: TokenId,
    receiver_id: AccountId,
    success: bool,
    completed_at: U64,
}

#[near(serializers = [json])]
pub struct Config {
    version: String,
    asset_id: AccountId,
    terms: Vec<u64>,
    storage_per_lock: U128,
    locked_principal: U128,
    timestamp: U64,
}

#[near(serializers = [json])]
struct Funding { action: String, duration: u64 }

#[ext_contract(ext_ft)]
trait FungiblePayout {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
}

#[ext_contract(ext_self)]
trait Settlement { fn on_redeem(&mut self, token_id: TokenId) -> bool; }

/// A reference source, separate from the Lockpad marketplace. No yield strategy.
#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct ReferenceVault {
    asset_id: AccountId,
    nft: NonFungibleToken,
    locks: LookupMap<TokenId, Lock>,
    credits: LookupMap<AccountId, u64>,
    transferring: LookupMap<TokenId, bool>,
    transfer_results: LookupMap<Vec<u8>, TransferResult>,
    next_id: u64,
    locked_principal: U128,
}

#[near]
impl ReferenceVault {
    #[init]
    pub fn new(asset_id: AccountId) -> Self {
        Self {
            asset_id,
            nft: NonFungibleToken::new(b"n", env::current_account_id(), Some(b"m"), Some(b"e"), None::<Vec<u8>>),
            locks: LookupMap::new(b"l"),
            credits: LookupMap::new(b"c"),
            transferring: LookupMap::new(b"t"),
            transfer_results: LookupMap::new(b"r"),
            next_id: 1,
            locked_principal: U128(0),
        }
    }

    pub fn get_config(&self) -> Config {
        Config {
            version: "lockpad-reference-v1".into(),
            asset_id: self.asset_id.clone(),
            terms: TERMS.to_vec(),
            storage_per_lock: U128(STORAGE.as_yoctonear()),
            locked_principal: self.locked_principal,
            timestamp: U64(env::block_timestamp()),
        }
    }

    #[payable]
    pub fn prepay_lock(&mut self) {
        require!(env::attached_deposit() == STORAGE, "Attach 0.03 NEAR per lock");
        let owner = env::predecessor_account_id();
        let count = self.lock_credits(owner.clone());
        self.credits.insert(owner, count.checked_add(1).expect("Too many credits"));
    }

    pub fn lock_credits(&self, owner_id: AccountId) -> u64 {
        self.credits.get(&owner_id).copied().unwrap_or(0)
    }

    pub fn get_position(&self, token_id: TokenId) -> Option<Position> {
        let lock = self.locks.get(&token_id)?;
        Some(Position {
            adapter_version: "lockpad-reference-v1".into(),
            owner_id: self.nft.owner_by_id.get(&token_id)?,
            asset_id: self.asset_id.clone(),
            principal: lock.principal,
            created_at: lock.created_at,
            unlock_at: lock.unlock_at,
            status: lock.status,
            transfer_pending: self.transferring.contains_key(&token_id),
            token_id,
        })
    }

    pub fn get_positions_by_owner(&self, owner_id: AccountId, from_index: U128, limit: u32) -> Vec<Position> {
        self.nft.nft_tokens_for_owner(owner_id, Some(from_index), Some(limit.clamp(1, 100) as u64))
            .into_iter().filter_map(|nft| self.get_position(nft.token_id)).collect()
    }

    /// Expiring, idempotent delivery lets the market safely reconcile a failed callback.
    /// Every attempt pays for its durable outcome, including failed attempts.
    #[payable]
    pub fn transfer_position(&mut self, receiver_id: AccountId, token_id: TokenId, request_id: String, valid_until: U64) -> bool {
        require!(env::attached_deposit() == TRANSFER_STORAGE, "Attach 0.005 NEAR for transfer receipt storage");
        require!(request_id.len() <= 64 && token_id.len() <= 64, "Transfer identifiers too long");
        let caller = env::predecessor_account_id();
        let key = Self::request_key(&caller, &request_id);
        if let Some(result) = self.transfer_results.get(&key) { return result.success; }
        let now = env::block_timestamp();
        let success = now <= valid_until.0
            && self.nft.owner_by_id.get(&token_id).as_ref() == Some(&caller)
            && receiver_id != caller
            && !self.transferring.contains_key(&token_id)
            && self.locks.get(&token_id).is_some_and(|lock| lock.status == Status::Active);
        if success {
            self.nft.internal_transfer(&caller, &receiver_id, &token_id, None, Some("Lockpad payout-right settlement".into()));
        }
        self.transfer_results.insert(key, TransferResult {
            token_id, receiver_id, success, completed_at: U64(now),
        });
        success
    }

    pub fn get_transfer_result(&self, caller_id: AccountId, request_id: String) -> Option<TransferResult> {
        if request_id.len() > 64 { return None; }
        self.transfer_results.get(&Self::request_key(&caller_id, &request_id)).cloned()
    }

    #[payable]
    pub fn redeem(&mut self, token_id: TokenId) -> Promise {
        assert_one_yocto();
        let owner = env::predecessor_account_id();
        require!(self.nft.owner_by_id.get(&token_id).as_ref() == Some(&owner), "Current payout owner only");
        let mut lock = self.active_lock(&token_id);
        require!(env::block_timestamp() >= lock.unlock_at.0, "Position has not matured");
        lock.status = Status::Redeeming;
        self.locks.insert(token_id.clone(), lock.clone());
        ext_ft::ext(self.asset_id.clone())
            .with_attached_deposit(ONE).with_static_gas(Gas::from_tgas(20))
            .ft_transfer(owner, lock.principal, Some("Lockpad reference vault maturity payout".into()))
            .then(ext_self::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(25)).on_redeem(token_id))
    }

    #[private]
    pub fn on_redeem(&mut self, token_id: TokenId) -> bool {
        let success = env::promise_result_checked(0, 64).is_ok();
        let Some(lock) = self.locks.get_mut(&token_id) else { return false; };
        if lock.status != Status::Redeeming { return false; }
        lock.status = if success { Status::Redeemed } else { Status::Active };
        if success { self.locked_principal.0 -= lock.principal.0; }
        env::log_str(&format!("EVENT_JSON:{{\"standard\":\"lockpad\",\"version\":\"1.0.0\",\"event\":\"redemption_resolved\",\"data\":[{{\"token_id\":\"{}\",\"success\":{}}}]}}", token_id, success));
        success
    }
}

impl ReferenceVault {
    fn request_key(caller: &AccountId, request_id: &str) -> Vec<u8> {
        env::sha256(format!("{}:{}", caller, request_id).as_bytes())
    }
    fn active_lock(&self, token_id: &TokenId) -> Lock {
        let lock = self.locks.get(token_id).expect("Unknown position");
        require!(lock.status == Status::Active && !self.transferring.contains_key(token_id), "Position is settling or redeemed");
        lock.clone()
    }

    fn mint_position(&mut self, owner: AccountId, amount: U128, duration: u64) {
        let count = self.lock_credits(owner.clone());
        if count == 1 { self.credits.remove(&owner); }
        else { self.credits.insert(owner.clone(), count - 1); }
        let token_id = self.next_id.to_string();
        self.next_id += 1;
        let created_at = env::block_timestamp();
        self.locks.insert(token_id.clone(), Lock {
            principal: amount,
            created_at: U64(created_at),
            unlock_at: U64(created_at + duration * SECOND),
            status: Status::Active,
        });
        self.locked_principal.0 += amount.0;
        self.nft.internal_mint_with_refund(token_id.clone(), owner.clone(), Some(TokenMetadata {
            title: Some(format!("Lockpad reference payout #{}", token_id)),
            description: Some("Redeemable for the fixed principal at the original maturity. Test instrument; no yield strategy.".into()),
            ..Default::default()
        }), None);
        NftMint { owner_id: &owner, token_ids: &[&token_id], memo: Some("Fixed-maturity test payout right") }.emit();
    }
}

#[near]
impl FungibleTokenReceiver for ReferenceVault {
    fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128> {
        if env::predecessor_account_id() != self.asset_id || amount.0 == 0 || msg.len() > 256 {
            return PromiseOrValue::Value(amount);
        }
        let Ok(funding) = serde_json::from_str::<Funding>(&msg) else { return PromiseOrValue::Value(amount); };
        if funding.action != "lock" || !TERMS.contains(&funding.duration) || self.lock_credits(sender_id.clone()) == 0 {
            return PromiseOrValue::Value(amount);
        }
        self.mint_position(sender_id, amount, funding.duration);
        PromiseOrValue::Value(U128(0))
    }
}

#[near]
impl NonFungibleTokenCore for ReferenceVault {
    #[payable]
    fn nft_transfer(&mut self, receiver_id: AccountId, token_id: TokenId, approval_id: Option<u64>, memo: Option<String>) {
        self.active_lock(&token_id);
        self.nft.nft_transfer(receiver_id, token_id, approval_id, memo);
    }

    #[payable]
    fn nft_transfer_call(&mut self, receiver_id: AccountId, token_id: TokenId, approval_id: Option<u64>, memo: Option<String>, msg: String) -> PromiseOrValue<bool> {
        self.active_lock(&token_id);
        require!(msg.len() <= 512, "Transfer message too long");
        let result = self.nft.nft_transfer_call(receiver_id, token_id.clone(), approval_id, memo, msg);
        self.transferring.insert(token_id, true);
        result
    }

    fn nft_token(&self, token_id: TokenId) -> Option<Token> { self.nft.nft_token(token_id) }
}

#[near]
impl NonFungibleTokenResolver for ReferenceVault {
    #[private]
    fn nft_resolve_transfer(&mut self, previous_owner_id: AccountId, receiver_id: AccountId, token_id: TokenId, approved_account_ids: Option<HashMap<AccountId, u64>>) -> bool {
        self.transferring.remove(&token_id);
        self.nft.nft_resolve_transfer(previous_owner_id, receiver_id, token_id, approved_account_ids)
    }
}

#[near]
impl NonFungibleTokenEnumeration for ReferenceVault {
    fn nft_total_supply(&self) -> U128 { self.nft.nft_total_supply() }
    fn nft_tokens(&self, from_index: Option<U128>, limit: Option<u64>) -> Vec<Token> { self.nft.nft_tokens(from_index, limit) }
    fn nft_supply_for_owner(&self, account_id: AccountId) -> U128 { self.nft.nft_supply_for_owner(account_id) }
    fn nft_tokens_for_owner(&self, account_id: AccountId, from_index: Option<U128>, limit: Option<u64>) -> Vec<Token> {
        self.nft.nft_tokens_for_owner(account_id, from_index, limit)
    }
}

#[near]
impl NonFungibleTokenMetadataProvider for ReferenceVault {
    fn nft_metadata(&self) -> NFTContractMetadata {
        NFTContractMetadata {
            spec: NFT_METADATA_SPEC.into(), name: "Lockpad reference payout right".into(), symbol: "LPLOCK".into(),
            icon: None, base_uri: None, reference: None, reference_hash: None,
        }
    }
}
