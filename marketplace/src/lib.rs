use near_contract_standards::{
    fungible_token::receiver::FungibleTokenReceiver,
    non_fungible_token::{core::NonFungibleTokenReceiver, TokenId},
};
use near_sdk::{
    assert_one_yocto, env, ext_contract, json_types::{U128, U64}, near, require,
    serde_json, store::{IterableMap, LookupMap}, AccountId, Gas, NearToken,
    PanicOnDefault, Promise, PromiseOrValue,
};

const ACCOUNT_STORAGE: NearToken = NearToken::from_millinear(30);
const LISTING_STORAGE: NearToken = NearToken::from_millinear(30);
const OPERATION_STORAGE: NearToken = NearToken::from_millinear(10);
const SOURCE_TRANSFER_STORAGE: NearToken = NearToken::from_millinear(5);
const ONE: NearToken = NearToken::from_yoctonear(1);
const SETTLEMENT_WINDOW: u64 = 120_000_000_000;
const MAX_SOURCE_RESULT: usize = 4096;

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum ListingStatus { Open, Buying, Canceling, Sold, Cancelled }

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Listing {
    id: U64,
    quote_nonce: U64,
    source_id: AccountId,
    token_id: TokenId,
    seller_id: AccountId,
    payout: U128,
    price: U128,
    source_created_at: U64,
    unlock_at: U64,
    listed_at: U64,
    status: ListingStatus,
    buyer_id: Option<AccountId>,
    attempt: U64,
    valid_until: U64,
    settled_at: Option<U64>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum WithdrawalKind { Balance, Proceeds }

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Withdrawal {
    kind: WithdrawalKind,
    amount: U128,
    attempt: U64,
    started_at: U64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Account {
    available: U128,
    proceeds: U128,
    listing_credits: u64,
    withdrawal: Option<Withdrawal>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Default)]
pub struct Accounting {
    available: U128,
    proceeds: U128,
    reserved_purchases: U128,
    pending_withdrawals: U128,
    completed_volume: U128,
    completed_sales: U64,
}

#[near(serializers = [json])]
pub struct Config {
    version: String,
    asset_id: AccountId,
    source_ids: Vec<AccountId>,
    account_storage: U128,
    listing_storage: U128,
    operation_storage: U128,
    settlement_window_seconds: u64,
    timestamp: U64,
}

#[near(serializers = [json])]
struct Position {
    adapter_version: String,
    token_id: TokenId,
    owner_id: AccountId,
    asset_id: AccountId,
    principal: U128,
    created_at: U64,
    unlock_at: U64,
    status: String,
}

#[near(serializers = [json])]
struct TransferResult {
    token_id: TokenId,
    receiver_id: AccountId,
    success: bool,
    completed_at: U64,
}

#[near(serializers = [json])]
struct ListingMessage { price: U128 }

#[near(serializers = [json])]
struct DepositMessage { action: String }

#[ext_contract(ext_source)]
trait PositionSource {
    fn get_position(&self, token_id: TokenId) -> Option<Position>;
    fn transfer_position(&mut self, receiver_id: AccountId, token_id: TokenId, request_id: String, valid_until: U64) -> bool;
    fn get_transfer_result(&self, caller_id: AccountId, request_id: String) -> Option<TransferResult>;
}

#[ext_contract(ext_ft)]
trait TokenPayout {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
}

#[ext_contract(ext_self)]
trait Settlement {
    fn on_listing(&mut self, source_id: AccountId, token_id: TokenId, seller_id: AccountId, price: U128) -> bool;
    fn on_delivery(&mut self, listing_id: U64, attempt: U64) -> bool;
    fn on_reconcile(&mut self, listing_id: U64, attempt: U64) -> bool;
    fn on_withdrawal(&mut self, account_id: AccountId, attempt: U64) -> bool;
}

/// Frozen source/token configuration; underlying principal never enters this contract.
#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Lockpad {
    asset_id: AccountId,
    source_ids: Vec<AccountId>,
    accounts: LookupMap<AccountId, Account>,
    listings: IterableMap<u64, Listing>,
    escrowed: LookupMap<Vec<u8>, U64>,
    next_listing: u64,
    next_attempt: u64,
    accounting: Accounting,
}

#[near]
impl Lockpad {
    #[init]
    pub fn new(asset_id: AccountId, source_ids: Vec<AccountId>) -> Self {
        require!(!source_ids.is_empty() && source_ids.len() <= 8, "Configure one to eight supported sources");
        for (index, source) in source_ids.iter().enumerate() {
            require!(!source_ids[..index].contains(source) && source != &env::current_account_id(), "Sources must be distinct external contracts");
        }
        Self {
            asset_id, source_ids,
            accounts: LookupMap::new(b"a"),
            listings: IterableMap::new(b"l"),
            escrowed: LookupMap::new(b"e"),
            next_listing: 1, next_attempt: 1,
            accounting: Accounting::default(),
        }
    }

    pub fn get_config(&self) -> Config {
        Config {
            version: "lockpad-market-v1".into(),
            asset_id: self.asset_id.clone(), source_ids: self.source_ids.clone(),
            account_storage: U128(ACCOUNT_STORAGE.as_yoctonear()),
            listing_storage: U128(LISTING_STORAGE.as_yoctonear()),
            operation_storage: U128(OPERATION_STORAGE.as_yoctonear()),
            settlement_window_seconds: SETTLEMENT_WINDOW / 1_000_000_000,
            timestamp: U64(env::block_timestamp()),
        }
    }

    pub fn get_account(&self, account_id: AccountId) -> Option<Account> { self.accounts.get(&account_id).cloned() }
    pub fn get_accounting(&self) -> Accounting { self.accounting.clone() }
    pub fn get_listing(&self, listing_id: U64) -> Option<Listing> { self.listings.get(&listing_id.0).cloned() }

    pub fn get_listings(&self, from_index: u32, limit: u32) -> Vec<Listing> {
        self.listings.values().filter(|listing| matches!(listing.status, ListingStatus::Open | ListingStatus::Buying | ListingStatus::Canceling))
            .skip(from_index as usize).take(limit.min(100) as usize).cloned().collect()
    }

    pub fn get_listings_by_seller(&self, seller_id: AccountId, from_index: u32, limit: u32) -> Vec<Listing> {
        self.listings.values().filter(|listing| listing.seller_id == seller_id)
            .skip(from_index as usize).take(limit.min(100) as usize).cloned().collect()
    }

    pub fn get_activity(&self, from_index: u32, limit: u32) -> Vec<Listing> {
        self.listings.values().filter(|listing| matches!(listing.status, ListingStatus::Sold | ListingStatus::Cancelled))
            .skip(from_index as usize).take(limit.min(100) as usize).cloned().collect()
    }

    #[payable]
    pub fn register_account(&mut self) {
        require!(env::attached_deposit() == ACCOUNT_STORAGE, "Attach 0.03 NEAR for account storage");
        let account_id = env::predecessor_account_id();
        require!(!self.accounts.contains_key(&account_id), "Account already registered");
        self.accounts.insert(account_id, Account { available: U128(0), proceeds: U128(0), listing_credits: 0, withdrawal: None });
    }

    #[payable]
    pub fn prepay_listing(&mut self) {
        require!(env::attached_deposit() == LISTING_STORAGE, "Attach 0.03 NEAR per listing");
        let account = self.accounts.get_mut(&env::predecessor_account_id()).expect("Register market account first");
        account.listing_credits = account.listing_credits.checked_add(1).expect("Too many listing credits");
    }

    #[payable]
    pub fn buy(&mut self, listing_id: U64, quote_nonce: U64) -> Promise {
        require!(env::attached_deposit() == OPERATION_STORAGE, "Attach 0.01 NEAR for settlement storage");
        let buyer = env::predecessor_account_id();
        let mut listing = self.listings.get(&listing_id.0).expect("Unknown listing").clone();
        require!(listing.status == ListingStatus::Open, "Listing is unavailable or settling");
        require!(listing.quote_nonce == quote_nonce, "Listing quote changed");
        require!(env::block_timestamp() < listing.unlock_at.0, "Position has matured");
        require!(buyer != listing.seller_id, "Seller cannot buy their own position");
        let account = self.accounts.get_mut(&buyer).expect("Register market account first");
        require!(account.available.0 >= listing.price.0, "Insufficient market balance; deposit before purchase");
        account.available.0 -= listing.price.0;
        self.accounting.available.0 -= listing.price.0;
        self.accounting.reserved_purchases.0 += listing.price.0;
        listing.status = ListingStatus::Buying;
        listing.buyer_id = Some(buyer);
        self.begin_delivery(listing)
    }

    #[payable]
    pub fn cancel_listing(&mut self, listing_id: U64) -> Promise {
        require!(env::attached_deposit() == OPERATION_STORAGE, "Attach 0.01 NEAR for return receipt storage");
        let mut listing = self.listings.get(&listing_id.0).expect("Unknown listing").clone();
        require!(env::predecessor_account_id() == listing.seller_id, "Listing seller only");
        require!(listing.status == ListingStatus::Open, "Position is settling or already sold");
        listing.status = ListingStatus::Canceling;
        self.begin_delivery(listing)
    }

    /// A late source call cannot deliver after its deadline. Safe even if a callback failed.
    pub fn reconcile(&mut self, listing_id: U64) -> Promise {
        let listing = self.listings.get(&listing_id.0).expect("Unknown listing");
        require!(matches!(listing.status, ListingStatus::Buying | ListingStatus::Canceling), "No pending NFT delivery");
        require!(env::block_timestamp() > listing.valid_until.0, "Settlement deadline has not passed");
        ext_source::ext(listing.source_id.clone()).with_static_gas(Gas::from_tgas(15))
            .get_transfer_result(env::current_account_id(), Self::request_id(listing))
            .then(ext_self::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(35)).on_reconcile(listing_id, listing.attempt))
    }

    #[payable]
    pub fn withdraw_balance(&mut self) -> Promise { assert_one_yocto(); self.withdraw(WithdrawalKind::Balance) }

    #[payable]
    pub fn withdraw_proceeds(&mut self) -> Promise { assert_one_yocto(); self.withdraw(WithdrawalKind::Proceeds) }

    #[private]
    pub fn on_listing(&mut self, source_id: AccountId, token_id: TokenId, seller_id: AccountId, price: U128) -> bool {
        // true returns the NFT to its original owner. Unexpected responses never activate a listing.
        let Some(position) = Self::read_result::<Option<Position>>().flatten() else { return true; };
        if position.adapter_version != "lockpad-reference-v1" || position.token_id != token_id
            || position.owner_id != env::current_account_id() || position.asset_id != self.asset_id
            || position.status != "Active" || position.unlock_at.0 <= env::block_timestamp()
            || price.0 == 0 || price.0 >= position.principal.0 { return true; }
        let key = Self::escrow_key(&source_id, &token_id);
        if self.escrowed.contains_key(&key) { return true; }
        let Some(account) = self.accounts.get_mut(&seller_id) else { return true; };
        if account.listing_credits == 0 { return true; }
        account.listing_credits -= 1;
        let id = self.next_listing;
        self.next_listing += 1;
        self.listings.insert(id, Listing {
            id: U64(id), quote_nonce: U64(id), source_id: source_id.clone(), token_id: token_id.clone(), seller_id: seller_id.clone(),
            payout: position.principal, price, source_created_at: position.created_at, unlock_at: position.unlock_at,
            listed_at: U64(env::block_timestamp()), status: ListingStatus::Open, buyer_id: None,
            attempt: U64(0), valid_until: U64(0), settled_at: None,
        });
        self.escrowed.insert(key, U64(id));
        Self::event("listed", serde_json::json!({ "listing_id": id.to_string(), "source_id": source_id, "token_id": token_id, "seller_id": seller_id, "price": price }));
        false
    }

    #[private]
    pub fn on_delivery(&mut self, listing_id: U64, attempt: U64) -> bool {
        match Self::read_result::<bool>() {
            Some(success) => self.finish_delivery(listing_id.0, attempt.0, success),
            // Do not guess whether a failed/malformed callback delivered an NFT. Keep the funds reserved.
            None => false,
        }
    }

    #[private]
    pub fn on_reconcile(&mut self, listing_id: U64, attempt: U64) -> bool {
        let Some(listing) = self.listings.get(&listing_id.0).cloned() else { return false; };
        if listing.attempt != attempt || env::block_timestamp() <= listing.valid_until.0 { return false; }
        let Some(result) = Self::read_result::<Option<TransferResult>>() else { return false; };
        let success = match result {
            None => false, // The expired delivery can no longer execute successfully.
            Some(result) => {
                let receiver = if listing.status == ListingStatus::Buying { listing.buyer_id.as_ref() } else { Some(&listing.seller_id) };
                if result.token_id != listing.token_id || receiver != Some(&result.receiver_id)
                    || (result.success && result.completed_at.0 > listing.valid_until.0) { return false; }
                result.success
            }
        };
        self.finish_delivery(listing_id.0, attempt.0, success)
    }

    #[private]
    pub fn on_withdrawal(&mut self, account_id: AccountId, attempt: U64) -> bool {
        let Some(account) = self.accounts.get_mut(&account_id) else { return false; };
        let Some(withdrawal) = account.withdrawal.clone() else { return false; };
        if withdrawal.attempt != attempt { return false; }
        let success = env::promise_result_checked(0, 64).is_ok();
        account.withdrawal = None;
        self.accounting.pending_withdrawals.0 -= withdrawal.amount.0;
        if !success {
            match withdrawal.kind {
                WithdrawalKind::Balance => { account.available.0 += withdrawal.amount.0; self.accounting.available.0 += withdrawal.amount.0; }
                WithdrawalKind::Proceeds => { account.proceeds.0 += withdrawal.amount.0; self.accounting.proceeds.0 += withdrawal.amount.0; }
            }
        }
        Self::event("withdrawal_resolved", serde_json::json!({ "account_id": account_id, "amount": withdrawal.amount, "success": success }));
        success
    }
}

impl Lockpad {
    fn escrow_key(source: &AccountId, token_id: &str) -> Vec<u8> { env::sha256(format!("{}:{}", source, token_id).as_bytes()) }
    fn request_id(listing: &Listing) -> String { format!("{}-{}", listing.id.0, listing.attempt.0) }

    fn read_result<T: near_sdk::serde::de::DeserializeOwned>() -> Option<T> {
        let bytes = env::promise_result_checked(0, MAX_SOURCE_RESULT).ok()?;
        serde_json::from_slice(&bytes).ok()
    }

    fn event(event: &str, data: serde_json::Value) {
        env::log_str(&format!("EVENT_JSON:{}", serde_json::json!({ "standard": "lockpad", "version": "1.0.0", "event": event, "data": [data] })));
    }

    fn begin_delivery(&mut self, mut listing: Listing) -> Promise {
        listing.attempt = U64(self.next_attempt);
        self.next_attempt += 1;
        listing.valid_until = U64(env::block_timestamp() + SETTLEMENT_WINDOW);
        let receiver = if listing.status == ListingStatus::Buying { listing.buyer_id.clone().expect("Buyer is required") } else { listing.seller_id.clone() };
        let id = listing.id;
        let attempt = listing.attempt;
        let promise = ext_source::ext(listing.source_id.clone())
            .with_attached_deposit(SOURCE_TRANSFER_STORAGE).with_static_gas(Gas::from_tgas(35))
            .transfer_position(receiver, listing.token_id.clone(), Self::request_id(&listing), listing.valid_until)
            .then(ext_self::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(35)).on_delivery(id, attempt));
        self.listings.insert(id.0, listing);
        promise
    }

    fn finish_delivery(&mut self, id: u64, attempt: u64, success: bool) -> bool {
        let Some(mut listing) = self.listings.get(&id).cloned() else { return false; };
        if listing.attempt.0 != attempt || !matches!(listing.status, ListingStatus::Buying | ListingStatus::Canceling) { return false; }
        if listing.status == ListingStatus::Buying {
            let Some(buyer) = listing.buyer_id.clone() else { return false; };
            let beneficiary = if success { &listing.seller_id } else { &buyer };
            let Some(account) = self.accounts.get_mut(beneficiary) else { return false; };
            self.accounting.reserved_purchases.0 -= listing.price.0;
            if success {
                account.proceeds.0 += listing.price.0;
                self.accounting.proceeds.0 += listing.price.0;
                self.accounting.completed_volume.0 += listing.price.0;
                self.accounting.completed_sales.0 += 1;
                listing.status = ListingStatus::Sold;
            } else {
                account.available.0 += listing.price.0;
                self.accounting.available.0 += listing.price.0;
                listing.status = ListingStatus::Open;
                listing.buyer_id = None;
            }
        } else {
            listing.status = if success { ListingStatus::Cancelled } else { ListingStatus::Open };
        }
        if success {
            self.escrowed.remove(&Self::escrow_key(&listing.source_id, &listing.token_id));
            listing.settled_at = Some(U64(env::block_timestamp()));
        }
        Self::event("delivery_resolved", serde_json::json!({ "listing_id": id.to_string(), "status": listing.status, "success": success }));
        self.listings.insert(id, listing);
        success
    }

    fn withdraw(&mut self, kind: WithdrawalKind) -> Promise {
        let account_id = env::predecessor_account_id();
        let account = self.accounts.get_mut(&account_id).expect("Register market account first");
        require!(account.withdrawal.is_none(), "A withdrawal is already pending; inspect its receipt");
        let amount = match kind { WithdrawalKind::Balance => account.available, WithdrawalKind::Proceeds => account.proceeds };
        require!(amount.0 > 0, "No funds available to withdraw");
        let attempt = U64(self.next_attempt);
        self.next_attempt += 1;
        match kind {
            WithdrawalKind::Balance => { account.available = U128(0); self.accounting.available.0 -= amount.0; }
            WithdrawalKind::Proceeds => { account.proceeds = U128(0); self.accounting.proceeds.0 -= amount.0; }
        }
        account.withdrawal = Some(Withdrawal { kind, amount, attempt, started_at: U64(env::block_timestamp()) });
        self.accounting.pending_withdrawals.0 += amount.0;
        ext_ft::ext(self.asset_id.clone()).with_attached_deposit(ONE).with_static_gas(Gas::from_tgas(20))
            .ft_transfer(account_id.clone(), amount, Some("Lockpad market withdrawal".into()))
            .then(ext_self::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(25)).on_withdrawal(account_id, attempt))
    }
}

#[near]
impl FungibleTokenReceiver for Lockpad {
    fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128> {
        if env::predecessor_account_id() != self.asset_id || amount.0 == 0 || msg.len() > 128 { return PromiseOrValue::Value(amount); }
        let Ok(message) = serde_json::from_str::<DepositMessage>(&msg) else { return PromiseOrValue::Value(amount); };
        if message.action != "deposit" { return PromiseOrValue::Value(amount); }
        let Some(account) = self.accounts.get_mut(&sender_id) else { return PromiseOrValue::Value(amount); };
        account.available.0 += amount.0;
        self.accounting.available.0 += amount.0;
        Self::event("deposited", serde_json::json!({ "account_id": sender_id, "amount": amount }));
        PromiseOrValue::Value(U128(0))
    }
}

#[near]
impl NonFungibleTokenReceiver for Lockpad {
    fn nft_on_transfer(&mut self, sender_id: AccountId, previous_owner_id: AccountId, token_id: TokenId, msg: String) -> PromiseOrValue<bool> {
        let source_id = env::predecessor_account_id();
        if !self.source_ids.contains(&source_id) || sender_id != previous_owner_id || token_id.len() > 64 || msg.len() > 256 { return PromiseOrValue::Value(true); }
        let Ok(message) = serde_json::from_str::<ListingMessage>(&msg) else { return PromiseOrValue::Value(true); };
        if message.price.0 == 0 || !self.accounts.get(&previous_owner_id).is_some_and(|account| account.listing_credits > 0) { return PromiseOrValue::Value(true); }
        PromiseOrValue::Promise(ext_source::ext(source_id.clone()).with_static_gas(Gas::from_tgas(15))
            .get_position(token_id.clone())
            .then(ext_self::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(35))
                .on_listing(source_id, token_id, previous_owner_id, message.price)))
    }
}
