use near_contract_standards::{
    fungible_token::receiver::FungibleTokenReceiver,
    non_fungible_token::{core::NonFungibleTokenReceiver, TokenId},
};
use near_sdk::{
    assert_one_yocto, env, ext_contract, json_types::{U128, U64}, near, require,
    serde_json, store::{IterableMap, LookupMap}, AccountId, Gas, NearToken,
    PanicOnDefault, Promise, PromiseOrValue,
};

const STORAGE: NearToken = NearToken::from_millinear(30);
const OPERATION_STORAGE: NearToken = NearToken::from_millinear(10);
const SOURCE_STORAGE: NearToken = NearToken::from_millinear(5);
const ONE: NearToken = NearToken::from_yoctonear(1);
const WINDOW: u64 = 120_000_000_000;
const LTV_BPS: u128 = 6_500;
const FEE_BPS: u128 = 200;

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum LoanStatus { CollateralReady, Checking, Disbursing, Active, RepaymentReady, Returning, Repaid, Cancelled, Settling, Settled }

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum ReturnKind { Cancel, Repay }

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Loan {
    id: U64,
    borrower_id: AccountId,
    source_id: AccountId,
    token_id: TokenId,
    collateral: U128,
    source_created_at: U64,
    unlock_at: U64,
    amount: U128,
    fee: U128,
    repay_amount: U128,
    status: LoanStatus,
    created_at: U64,
    attempt: U64,
    valid_until: U64,
    return_kind: Option<ReturnKind>,
    completed_at: Option<U64>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Withdrawal { amount: U128, attempt: U64 }

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Account { loan_credits: u64, surplus: U128, withdrawal: Option<Withdrawal> }

#[near(serializers = [borsh, json])]
#[derive(Clone, Default)]
pub struct Accounting {
    available_liquidity: U128,
    reserved_loans: U128,
    outstanding_principal: U128,
    borrower_surplus: U128,
    pending_withdrawals: U128,
    total_borrowed: U128,
    total_repaid: U128,
    total_settled: U128,
    fees_received: U128,
}

#[near(serializers = [json])]
pub struct Config {
    version: String, asset_id: AccountId, source_ids: Vec<AccountId>, funder_id: AccountId,
    ltv_bps: u32, fee_bps: u32, quote_nonce: U64,
    account_storage: U128, loan_storage: U128, operation_storage: U128, timestamp: U64,
}

#[near(serializers = [json])]
pub struct Quote { maximum: U128, fee: U128, repay_amount: U128, quote_nonce: U64, available_liquidity: U128, eligible: bool }

#[near(serializers = [json])]
struct Position {
    adapter_version: String, token_id: TokenId, owner_id: AccountId, asset_id: AccountId,
    principal: U128, created_at: U64, unlock_at: U64, status: String, transfer_pending: bool,
}

#[near(serializers = [json])]
struct TransferResult { token_id: TokenId, receiver_id: AccountId, success: bool, completed_at: U64 }

#[near(serializers = [json])]
struct CollateralMessage { amount: U128, principal: U128, unlock_at: U64, quote_nonce: U64 }

#[near(serializers = [json])]
struct FundingMessage { action: String, loan_id: Option<U64> }

#[ext_contract(ext_source)]
trait PositionSource {
    fn get_position(&self, token_id: TokenId) -> Option<Position>;
    fn transfer_position(&mut self, receiver_id: AccountId, token_id: TokenId, request_id: String, valid_until: U64) -> bool;
    fn get_transfer_result(&self, caller_id: AccountId, request_id: String) -> Option<TransferResult>;
    fn redeem(&mut self, token_id: TokenId) -> Promise;
}

#[ext_contract(ext_ft)]
trait TokenPayout { fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>); }

#[ext_contract(ext_self)]
trait Settlement {
    fn on_collateral(&mut self, source_id: AccountId, token_id: TokenId, borrower_id: AccountId, message: CollateralMessage) -> bool;
    fn on_draw_source(&mut self, loan_id: U64, attempt: U64) -> PromiseOrValue<bool>;
    fn on_disbursement(&mut self, loan_id: U64, attempt: U64) -> bool;
    fn on_return(&mut self, loan_id: U64, attempt: U64) -> bool;
    fn on_return_receipt(&mut self, loan_id: U64, attempt: U64) -> bool;
    fn on_maturity(&mut self, loan_id: U64) -> bool;
    fn on_maturity_position(&mut self, loan_id: U64) -> bool;
    fn on_surplus(&mut self, account_id: AccountId, attempt: U64) -> bool;
}

/// Funded reference pool. Principal stays at the source; only its payout NFT is collateral.
#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct LendingPool {
    asset_id: AccountId,
    source_ids: Vec<AccountId>,
    funder_id: AccountId,
    accounts: LookupMap<AccountId, Account>,
    loans: IterableMap<u64, Loan>,
    escrowed: LookupMap<Vec<u8>, U64>,
    next_loan: u64,
    next_attempt: u64,
    quote_nonce: u64,
    accounting: Accounting,
}

#[near]
impl LendingPool {
    #[init]
    pub fn new(asset_id: AccountId, source_ids: Vec<AccountId>, funder_id: AccountId) -> Self {
        require!(!source_ids.is_empty() && source_ids.len() <= 8, "Configure one to eight supported sources");
        for (index, source) in source_ids.iter().enumerate() {
            require!(!source_ids[..index].contains(source) && source != &env::current_account_id(), "Distinct external sources only");
        }
        Self { asset_id, source_ids, funder_id, accounts: LookupMap::new(b"a"), loans: IterableMap::new(b"l"), escrowed: LookupMap::new(b"e"), next_loan: 1, next_attempt: 1, quote_nonce: 1, accounting: Accounting::default() }
    }

    pub fn get_config(&self) -> Config {
        Config { version: "lockpad-lending-v1".into(), asset_id: self.asset_id.clone(), source_ids: self.source_ids.clone(), funder_id: self.funder_id.clone(), ltv_bps: LTV_BPS as u32, fee_bps: FEE_BPS as u32, quote_nonce: U64(self.quote_nonce), account_storage: U128(STORAGE.as_yoctonear()), loan_storage: U128(STORAGE.as_yoctonear()), operation_storage: U128(OPERATION_STORAGE.as_yoctonear()), timestamp: U64(env::block_timestamp()) }
    }

    pub fn get_quote(&self, principal: U128, unlock_at: U64) -> Quote {
        let maximum = if unlock_at.0 > env::block_timestamp() { Self::bps(principal.0, LTV_BPS, false).min(self.accounting.available_liquidity.0) } else { 0 };
        let fee = Self::bps(maximum, FEE_BPS, true);
        Quote { maximum: U128(maximum), fee: U128(fee), repay_amount: U128(maximum + fee), quote_nonce: U64(self.quote_nonce), available_liquidity: self.accounting.available_liquidity, eligible: maximum > 0 }
    }

    pub fn get_accounting(&self) -> Accounting { self.accounting.clone() }
    pub fn get_account(&self, account_id: AccountId) -> Option<Account> { self.accounts.get(&account_id).cloned() }
    pub fn get_loan(&self, loan_id: U64) -> Option<Loan> { self.loans.get(&loan_id.0).cloned() }
    pub fn get_loans_by_borrower(&self, borrower_id: AccountId, from_index: u32, limit: u32) -> Vec<Loan> {
        self.loans.values().filter(|loan| loan.borrower_id == borrower_id).skip(from_index as usize).take(limit.min(100) as usize).cloned().collect()
    }

    #[payable]
    pub fn register_account(&mut self) {
        require!(env::attached_deposit() == STORAGE, "Attach 0.03 NEAR for pool account storage");
        let id = env::predecessor_account_id();
        require!(!self.accounts.contains_key(&id), "Pool account already registered");
        self.accounts.insert(id, Account { loan_credits: 0, surplus: U128(0), withdrawal: None });
    }

    #[payable]
    pub fn prepay_loan(&mut self) {
        require!(env::attached_deposit() == STORAGE, "Attach 0.03 NEAR per loan");
        let account = self.accounts.get_mut(&env::predecessor_account_id()).expect("Register pool account first");
        account.loan_credits = account.loan_credits.checked_add(1).expect("Too many credits");
    }

    #[payable]
    pub fn draw_loan(&mut self, loan_id: U64) -> Promise {
        assert_one_yocto();
        let mut loan = self.borrower_loan(loan_id);
        require!(loan.status == LoanStatus::CollateralReady && env::block_timestamp() < loan.unlock_at.0, "Loan is unavailable or matured");
        loan.status = LoanStatus::Checking;
        loan.attempt = U64(self.next_attempt); self.next_attempt += 1;
        loan.valid_until = U64(env::block_timestamp() + WINDOW);
        let promise = ext_source::ext(loan.source_id.clone()).with_static_gas(Gas::from_tgas(15)).get_position(loan.token_id.clone())
            .then(ext_self::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(65)).on_draw_source(loan.id, loan.attempt));
        self.loans.insert(loan.id.0, loan);
        promise
    }

    pub fn reset_expired_check(&mut self, loan_id: U64) {
        let mut loan = self.borrower_loan(loan_id);
        require!(loan.status == LoanStatus::Checking && env::block_timestamp() > loan.valid_until.0, "No expired collateral check");
        loan.status = LoanStatus::CollateralReady;
        self.loans.insert(loan.id.0, loan);
    }

    #[payable]
    pub fn cancel_collateral(&mut self, loan_id: U64) -> Promise {
        let loan = self.borrower_loan(loan_id);
        require!(loan.status == LoanStatus::CollateralReady, "Only an undrawn loan can be cancelled");
        self.begin_return(loan, ReturnKind::Cancel)
    }

    #[payable]
    pub fn release_collateral(&mut self, loan_id: U64) -> Promise {
        let loan = self.borrower_loan(loan_id);
        require!(loan.status == LoanStatus::RepaymentReady, "Repay the loan before returning collateral");
        self.begin_return(loan, ReturnKind::Repay)
    }

    pub fn reconcile_return(&mut self, loan_id: U64) -> Promise {
        let loan = self.loans.get(&loan_id.0).expect("Unknown loan");
        require!(loan.status == LoanStatus::Returning && env::block_timestamp() > loan.valid_until.0, "Return deadline has not passed");
        ext_source::ext(loan.source_id.clone()).with_static_gas(Gas::from_tgas(15))
            .get_transfer_result(env::current_account_id(), Self::request_id(loan))
            .then(ext_self::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(30)).on_return_receipt(loan.id, loan.attempt))
    }

    #[payable]
    pub fn settle_maturity(&mut self, loan_id: U64) -> Promise {
        assert_one_yocto();
        let mut loan = self.loans.get(&loan_id.0).expect("Unknown loan").clone();
        require!(loan.status == LoanStatus::Active && env::block_timestamp() >= loan.unlock_at.0, "Unpaid loan has not matured");
        loan.status = LoanStatus::Settling;
        let promise = ext_source::ext(loan.source_id.clone()).with_attached_deposit(ONE).with_static_gas(Gas::from_tgas(65)).redeem(loan.token_id.clone())
            .then(ext_self::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(35)).on_maturity(loan.id));
        self.loans.insert(loan.id.0, loan);
        promise
    }

    pub fn reconcile_maturity(&mut self, loan_id: U64) -> Promise {
        let loan = self.loans.get(&loan_id.0).expect("Unknown loan");
        require!(loan.status == LoanStatus::Settling, "No pending maturity payout");
        ext_source::ext(loan.source_id.clone()).with_static_gas(Gas::from_tgas(15)).get_position(loan.token_id.clone())
            .then(ext_self::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(35)).on_maturity_position(loan.id))
    }

    #[payable]
    pub fn withdraw_surplus(&mut self) -> Promise {
        assert_one_yocto();
        let id = env::predecessor_account_id();
        let account = self.accounts.get_mut(&id).expect("Register pool account first");
        require!(account.withdrawal.is_none() && account.surplus.0 > 0, "No surplus available or a withdrawal is pending");
        let amount = account.surplus;
        let attempt = U64(self.next_attempt); self.next_attempt += 1;
        account.surplus = U128(0); account.withdrawal = Some(Withdrawal { amount, attempt });
        self.accounting.borrower_surplus.0 -= amount.0; self.accounting.pending_withdrawals.0 += amount.0;
        ext_ft::ext(self.asset_id.clone()).with_attached_deposit(ONE).with_static_gas(Gas::from_tgas(20))
            .ft_transfer(id.clone(), amount, Some("Lockpad collateral surplus".into()))
            .then(ext_self::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(25)).on_surplus(id, attempt))
    }

    #[private]
    pub fn on_collateral(&mut self, source_id: AccountId, token_id: TokenId, borrower_id: AccountId, message: CollateralMessage) -> bool {
        let Some(position) = Self::read_result::<Option<Position>>().flatten() else { return true; };
        let quote = self.get_quote(position.principal, position.unlock_at);
        let key = Self::escrow_key(&source_id, &token_id);
        if !self.source_ids.contains(&source_id) || position.adapter_version != "lockpad-reference-v1" || position.token_id != token_id
            || position.owner_id != env::current_account_id() || position.asset_id != self.asset_id || position.status != "Active"
            || position.principal != message.principal || position.unlock_at != message.unlock_at || !quote.eligible
            || message.quote_nonce != quote.quote_nonce || message.amount.0 == 0 || message.amount.0 > quote.maximum.0 || self.escrowed.contains_key(&key) { return true; }
        let Some(account) = self.accounts.get_mut(&borrower_id) else { return true; };
        if account.loan_credits == 0 { return true; }
        account.loan_credits -= 1;
        let fee = U128(Self::bps(message.amount.0, FEE_BPS, true));
        let repay_amount = U128(message.amount.0 + fee.0);
        if repay_amount.0 > position.principal.0 { account.loan_credits += 1; return true; }
        let id = self.next_loan; self.next_loan += 1;
        self.accounting.available_liquidity.0 -= message.amount.0; self.accounting.reserved_loans.0 += message.amount.0; self.quote_nonce += 1;
        self.loans.insert(id, Loan { id: U64(id), borrower_id: borrower_id.clone(), source_id: source_id.clone(), token_id: token_id.clone(), collateral: position.principal, source_created_at: position.created_at, unlock_at: position.unlock_at,
            amount: message.amount, fee, repay_amount, status: LoanStatus::CollateralReady, created_at: U64(env::block_timestamp()), attempt: U64(0), valid_until: U64(0), return_kind: None, completed_at: None });
        self.escrowed.insert(key, U64(id));
        Self::event("collateral_accepted", serde_json::json!({ "loan_id": id.to_string(), "borrower_id": borrower_id, "amount": message.amount }));
        false
    }

    #[private]
    pub fn on_draw_source(&mut self, loan_id: U64, attempt: U64) -> PromiseOrValue<bool> {
        let Some(mut loan) = self.loans.get(&loan_id.0).cloned() else { return PromiseOrValue::Value(false); };
        if loan.status != LoanStatus::Checking || loan.attempt != attempt { return PromiseOrValue::Value(false); }
        let valid = Self::read_result::<Option<Position>>().flatten().is_some_and(|p| self.matches_source(&loan, &p) && p.status == "Active" && !p.transfer_pending);
        if !valid || env::block_timestamp() >= loan.unlock_at.0 || env::block_timestamp() > loan.valid_until.0 {
            loan.status = LoanStatus::CollateralReady; self.loans.insert(loan.id.0, loan); return PromiseOrValue::Value(false);
        }
        loan.status = LoanStatus::Disbursing;
        let promise = ext_ft::ext(self.asset_id.clone()).with_attached_deposit(ONE).with_static_gas(Gas::from_tgas(20))
            .ft_transfer(loan.borrower_id.clone(), loan.amount, Some("Lockpad secured loan".into()))
            .then(ext_self::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(25)).on_disbursement(loan.id, attempt));
        self.loans.insert(loan.id.0, loan);
        PromiseOrValue::Promise(promise)
    }

    #[private]
    pub fn on_disbursement(&mut self, loan_id: U64, attempt: U64) -> bool {
        let Some(mut loan) = self.loans.get(&loan_id.0).cloned() else { return false; };
        if loan.status != LoanStatus::Disbursing || loan.attempt != attempt { return false; }
        let success = env::promise_result_checked(0, 64).is_ok();
        loan.status = if success { LoanStatus::Active } else { LoanStatus::CollateralReady };
        if success { self.accounting.reserved_loans.0 -= loan.amount.0; self.accounting.outstanding_principal.0 += loan.amount.0; self.accounting.total_borrowed.0 += loan.amount.0; }
        Self::event("loan_disbursed", serde_json::json!({ "loan_id": loan_id, "amount": loan.amount, "success": success }));
        self.loans.insert(loan.id.0, loan); success
    }

    #[private]
    pub fn on_return(&mut self, loan_id: U64, attempt: U64) -> bool {
        Self::read_result::<bool>().is_some_and(|success| self.finish_return(loan_id.0, attempt.0, success))
    }

    #[private]
    pub fn on_return_receipt(&mut self, loan_id: U64, attempt: U64) -> bool {
        let Some(loan) = self.loans.get(&loan_id.0).cloned() else { return false; };
        if loan.status != LoanStatus::Returning || loan.attempt != attempt || env::block_timestamp() <= loan.valid_until.0 { return false; }
        let Some(result) = Self::read_result::<Option<TransferResult>>() else { return false; };
        let success = match result {
            None => false,
            Some(r) => { if r.token_id != loan.token_id || r.receiver_id != loan.borrower_id || (r.success && r.completed_at.0 > loan.valid_until.0) { return false; } r.success }
        };
        self.finish_return(loan.id.0, attempt.0, success)
    }

    #[private]
    pub fn on_maturity(&mut self, loan_id: U64) -> bool {
        match Self::read_result::<bool>() {
            Some(true) => self.finish_maturity(loan_id.0),
            Some(false) => { if let Some(loan) = self.loans.get_mut(&loan_id.0) { if loan.status == LoanStatus::Settling { loan.status = LoanStatus::Active; } } false },
            None => false,
        }
    }

    #[private]
    pub fn on_maturity_position(&mut self, loan_id: U64) -> bool {
        let Some(loan) = self.loans.get(&loan_id.0).cloned() else { return false; };
        if loan.status != LoanStatus::Settling { return false; }
        let Some(position) = Self::read_result::<Option<Position>>().flatten() else { return false; };
        if !self.matches_source(&loan, &position) || position.transfer_pending { return false; }
        if position.status == "Redeemed" { self.finish_maturity(loan.id.0) }
        else { if position.status == "Active" { self.loans.get_mut(&loan.id.0).unwrap().status = LoanStatus::Active; } false }
    }

    #[private]
    pub fn on_surplus(&mut self, account_id: AccountId, attempt: U64) -> bool {
        let Some(account) = self.accounts.get_mut(&account_id) else { return false; };
        let Some(withdrawal) = account.withdrawal.clone() else { return false; };
        if withdrawal.attempt != attempt { return false; }
        let success = env::promise_result_checked(0, 64).is_ok();
        account.withdrawal = None; self.accounting.pending_withdrawals.0 -= withdrawal.amount.0;
        if !success { account.surplus.0 += withdrawal.amount.0; self.accounting.borrower_surplus.0 += withdrawal.amount.0; }
        Self::event("surplus_withdrawn", serde_json::json!({ "account_id": account_id, "amount": withdrawal.amount, "success": success }));
        success
    }
}

impl LendingPool {
    fn bps(amount: u128, rate: u128, round_up: bool) -> u128 { (amount / 10_000) * rate + ((amount % 10_000) * rate + if round_up { 9_999 } else { 0 }) / 10_000 }
    fn escrow_key(source: &AccountId, token: &str) -> Vec<u8> { env::sha256(format!("{}:{}", source, token).as_bytes()) }
    fn request_id(loan: &Loan) -> String { format!("loan-{}-{}", loan.id.0, loan.attempt.0) }
    fn read_result<T: near_sdk::serde::de::DeserializeOwned>() -> Option<T> { serde_json::from_slice(&env::promise_result_checked(0, 4096).ok()?).ok() }
    fn event(name: &str, data: serde_json::Value) { env::log_str(&format!("EVENT_JSON:{}", serde_json::json!({ "standard": "lockpad", "version": "1.0.0", "event": name, "data": [data] }))); }
    fn borrower_loan(&self, id: U64) -> Loan { let loan = self.loans.get(&id.0).expect("Unknown loan").clone(); require!(loan.borrower_id == env::predecessor_account_id(), "Loan borrower only"); loan }
    fn matches_source(&self, loan: &Loan, position: &Position) -> bool { position.adapter_version == "lockpad-reference-v1" && position.token_id == loan.token_id && position.owner_id == env::current_account_id() && position.asset_id == self.asset_id && position.principal == loan.collateral && position.created_at == loan.source_created_at && position.unlock_at == loan.unlock_at }

    fn begin_return(&mut self, mut loan: Loan, kind: ReturnKind) -> Promise {
        require!(env::attached_deposit() == OPERATION_STORAGE, "Attach 0.01 NEAR for return receipt storage");
        loan.status = LoanStatus::Returning; loan.return_kind = Some(kind);
        loan.attempt = U64(self.next_attempt); self.next_attempt += 1; loan.valid_until = U64(env::block_timestamp() + WINDOW);
        let promise = ext_source::ext(loan.source_id.clone()).with_attached_deposit(SOURCE_STORAGE).with_static_gas(Gas::from_tgas(35))
            .transfer_position(loan.borrower_id.clone(), loan.token_id.clone(), Self::request_id(&loan), loan.valid_until)
            .then(ext_self::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(35)).on_return(loan.id, loan.attempt));
        self.loans.insert(loan.id.0, loan); promise
    }

    fn finish_return(&mut self, id: u64, attempt: u64, success: bool) -> bool {
        let Some(mut loan) = self.loans.get(&id).cloned() else { return false; };
        if loan.status != LoanStatus::Returning || loan.attempt.0 != attempt { return false; }
        let Some(kind) = loan.return_kind else { return false; };
        loan.status = match (kind, success) { (ReturnKind::Cancel, true) => LoanStatus::Cancelled, (ReturnKind::Cancel, false) => LoanStatus::CollateralReady, (ReturnKind::Repay, true) => LoanStatus::Repaid, (ReturnKind::Repay, false) => LoanStatus::RepaymentReady };
        if success {
            if kind == ReturnKind::Cancel { self.accounting.reserved_loans.0 -= loan.amount.0; self.accounting.available_liquidity.0 += loan.amount.0; self.quote_nonce += 1; }
            self.escrowed.remove(&Self::escrow_key(&loan.source_id, &loan.token_id)); loan.completed_at = Some(U64(env::block_timestamp()));
        }
        Self::event("collateral_returned", serde_json::json!({ "loan_id": loan.id, "status": loan.status, "success": success }));
        self.loans.insert(id, loan); success
    }

    fn finish_maturity(&mut self, id: u64) -> bool {
        let Some(mut loan) = self.loans.get(&id).cloned() else { return false; };
        if loan.status != LoanStatus::Settling { return false; }
        let surplus = loan.collateral.0 - loan.repay_amount.0;
        let Some(account) = self.accounts.get_mut(&loan.borrower_id) else { return false; };
        account.surplus.0 += surplus;
        self.accounting.borrower_surplus.0 += surplus; self.accounting.available_liquidity.0 += loan.repay_amount.0;
        self.accounting.outstanding_principal.0 -= loan.amount.0; self.accounting.total_settled.0 += loan.repay_amount.0; self.accounting.fees_received.0 += loan.fee.0;
        self.quote_nonce += 1; loan.status = LoanStatus::Settled; loan.completed_at = Some(U64(env::block_timestamp()));
        self.escrowed.remove(&Self::escrow_key(&loan.source_id, &loan.token_id));
        Self::event("maturity_settled", serde_json::json!({ "loan_id": loan.id, "amount_due": loan.repay_amount, "borrower_surplus": surplus }));
        self.loans.insert(id, loan); true
    }
}

#[near]
impl FungibleTokenReceiver for LendingPool {
    fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128> {
        if env::predecessor_account_id() != self.asset_id || amount.0 == 0 || msg.len() > 256 { return PromiseOrValue::Value(amount); }
        let Ok(message) = serde_json::from_str::<FundingMessage>(&msg) else { return PromiseOrValue::Value(amount); };
        if message.action == "fund" && sender_id == self.funder_id {
            self.accounting.available_liquidity.0 = self.accounting.available_liquidity.0.checked_add(amount.0).expect("Liquidity overflow"); self.quote_nonce += 1;
            Self::event("pool_funded", serde_json::json!({ "amount": amount })); return PromiseOrValue::Value(U128(0));
        }
        if message.action != "repay" { return PromiseOrValue::Value(amount); }
        let Some(id) = message.loan_id else { return PromiseOrValue::Value(amount); };
        let Some(mut loan) = self.loans.get(&id.0).cloned() else { return PromiseOrValue::Value(amount); };
        if loan.borrower_id != sender_id || loan.status != LoanStatus::Active || env::block_timestamp() >= loan.unlock_at.0 || amount != loan.repay_amount { return PromiseOrValue::Value(amount); }
        loan.status = LoanStatus::RepaymentReady;
        self.accounting.available_liquidity.0 += amount.0; self.accounting.outstanding_principal.0 -= loan.amount.0; self.accounting.total_repaid.0 += amount.0; self.accounting.fees_received.0 += loan.fee.0; self.quote_nonce += 1;
        Self::event("loan_repaid", serde_json::json!({ "loan_id": id, "amount": amount })); self.loans.insert(id.0, loan);
        PromiseOrValue::Value(U128(0))
    }
}

#[near]
impl NonFungibleTokenReceiver for LendingPool {
    fn nft_on_transfer(&mut self, sender_id: AccountId, previous_owner_id: AccountId, token_id: TokenId, msg: String) -> PromiseOrValue<bool> {
        let source_id = env::predecessor_account_id();
        if !self.source_ids.contains(&source_id) || sender_id != previous_owner_id || token_id.len() > 64 || msg.len() > 512 { return PromiseOrValue::Value(true); }
        let Ok(message) = serde_json::from_str::<CollateralMessage>(&msg) else { return PromiseOrValue::Value(true); };
        if !self.accounts.get(&previous_owner_id).is_some_and(|account| account.loan_credits > 0) { return PromiseOrValue::Value(true); }
        PromiseOrValue::Promise(ext_source::ext(source_id.clone()).with_static_gas(Gas::from_tgas(15)).get_position(token_id.clone())
            .then(ext_self::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(35)).on_collateral(source_id, token_id, previous_owner_id, message)))
    }
}
