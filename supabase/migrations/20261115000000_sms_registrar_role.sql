-- Registrar: manages student records and admissions without full administrator rights.
-- On its own because Postgres only allows using a new enum value after the statement adding it is committed.
-- Run after 20261114000000_sms_timetable.sql, and before 20261115000100_sms_student_records.sql.

ALTER TYPE sms.school_role ADD VALUE IF NOT EXISTS 'registrar';
