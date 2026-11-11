-- Accountant: manages fees, payments and expenses without full administrator rights.
-- On its own because Postgres only allows using a new enum value after the statement adding it is committed.
-- Run after 20261118000000_sms_fixes.sql, and before 20261119000100_sms_finance.sql.

ALTER TYPE sms.school_role ADD VALUE IF NOT EXISTS 'accountant';
