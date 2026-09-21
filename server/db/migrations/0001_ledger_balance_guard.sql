-- The last line of defence for "every rupee must remain accountable".
--
-- Column constraints can police a single row; they cannot say "these rows must
-- sum to zero". A DEFERRABLE constraint trigger can: it runs at COMMIT, once
-- all of a transaction's entries are in place, and aborts the whole database
-- transaction if the books do not balance.
--
-- The application already refuses to build unbalanced entries. This exists so
-- that a bug in the application cannot corrupt the ledger anyway.

CREATE OR REPLACE FUNCTION assert_transaction_balances() RETURNS trigger AS $$
DECLARE
  target_transaction uuid;
  entry_count int;
  entry_sum bigint;
BEGIN
  target_transaction := COALESCE(NEW.transaction_id, OLD.transaction_id);

  SELECT count(*), COALESCE(sum(amount), 0)
    INTO entry_count, entry_sum
    FROM ledger_entries
   WHERE transaction_id = target_transaction;

  -- The transaction row itself was deleted (cascade); nothing left to check.
  IF entry_count = 0 THEN
    RETURN NULL;
  END IF;

  IF entry_count < 2 THEN
    RAISE EXCEPTION 'Transaction % has only % ledger entry; double entry requires at least two',
      target_transaction, entry_count
      USING ERRCODE = 'check_violation';
  END IF;

  IF entry_sum <> 0 THEN
    RAISE EXCEPTION 'Transaction % does not balance (off by % paise)', target_transaction, entry_sum
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS ledger_entries_balance_guard ON ledger_entries;
--> statement-breakpoint

CREATE CONSTRAINT TRIGGER ledger_entries_balance_guard
  AFTER INSERT OR UPDATE OR DELETE ON ledger_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION assert_transaction_balances();
--> statement-breakpoint

-- Reading a balance always means summing this table, so the aggregate paths
-- get covering indexes rather than a cached-balance column that could drift.
CREATE INDEX IF NOT EXISTS entries_balance_asset_idx
  ON ledger_entries (user_id, account_id, pool_id)
  INCLUDE (amount)
  WHERE bucket = 'asset';
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS entries_balance_debt_idx
  ON ledger_entries (user_id, person_id)
  INCLUDE (amount)
  WHERE bucket IN ('receivable', 'payable');
