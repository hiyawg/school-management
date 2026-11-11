-- Staff performance records and payroll.
-- Run after 20261115000100_sms_student_records.sql.

-- Performance records ------------------------------------------------------
-- Classroom observations, evaluations, commendations and concerns, written by administrators.
-- The staff member sees the ones shared with them, and can acknowledge and reply.

CREATE TABLE sms.staff_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES sms.schools(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  evaluator_id uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  kind text NOT NULL DEFAULT 'observation' CHECK (kind IN ('observation', 'evaluation', 'commendation', 'concern')),
  date date NOT NULL DEFAULT current_date,
  class_subject_id uuid REFERENCES sms.class_subjects(id) ON DELETE SET NULL,  -- the lesson observed
  ratings jsonb NOT NULL DEFAULT '{}',   -- criterion → 1..5
  overall numeric,                       -- average of ratings, set by trigger
  strengths text,
  improvements text,
  notes text,
  shared boolean NOT NULL DEFAULT true,
  acknowledged_at timestamptz,
  staff_response text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_sms_evaluations_user ON sms.staff_evaluations(school_id, user_id);

CREATE OR REPLACE FUNCTION sms.evaluation_overall() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM jsonb_each(NEW.ratings) r
             WHERE jsonb_typeof(r.value) <> 'number' OR r.value::numeric NOT BETWEEN 1 AND 5) THEN
    RAISE EXCEPTION 'Ratings must be numbers from 1 to 5' USING ERRCODE = '22023';
  END IF;
  NEW.overall = (SELECT round(avg(value::numeric), 1) FROM jsonb_each(NEW.ratings));
  RETURN NEW;
END $$;
CREATE TRIGGER trg_evaluations_overall BEFORE INSERT OR UPDATE OF ratings ON sms.staff_evaluations
FOR EACH ROW EXECUTE FUNCTION sms.evaluation_overall();

ALTER TABLE sms.staff_evaluations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins or own shared read" ON sms.staff_evaluations FOR SELECT TO authenticated
  USING (sms.is_admin(school_id) OR (user_id = auth.uid() AND shared));
CREATE POLICY "admins write" ON sms.staff_evaluations FOR ALL TO authenticated
  USING (sms.is_admin(school_id)) WITH CHECK (sms.is_admin(school_id));

CREATE OR REPLACE FUNCTION sms.acknowledge_evaluation(_id uuid, _response text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = sms, public AS $$
BEGIN
  UPDATE sms.staff_evaluations
  SET acknowledged_at = coalesce(acknowledged_at, now()), staff_response = coalesce(nullif(trim(_response), ''), staff_response)
  WHERE id = _id AND user_id = auth.uid() AND shared;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Only the staff member can acknowledge their own record' USING ERRCODE = '42501';
  END IF;
END $$;

-- Payroll settings -----------------------------------------------------------
-- Defaults: Income Tax Proclamation 1395/2025 monthly employment brackets and 7% / 11% pension
-- (Proclamation 1268/2022). Each school should have its accountant confirm them; they are editable.

CREATE TABLE sms.payroll_settings (
  school_id uuid PRIMARY KEY REFERENCES sms.schools(id) ON DELETE CASCADE,
  employee_pension_rate numeric NOT NULL DEFAULT 7 CHECK (employee_pension_rate BETWEEN 0 AND 100),
  employer_pension_rate numeric NOT NULL DEFAULT 11 CHECK (employer_pension_rate BETWEEN 0 AND 100),
  -- Progressive brackets in order: [{"up_to": 2000, "rate": 0}, ..., {"up_to": null, "rate": 35}]
  tax_brackets jsonb NOT NULL DEFAULT '[
    {"up_to": 2000, "rate": 0}, {"up_to": 4000, "rate": 15}, {"up_to": 7000, "rate": 20},
    {"up_to": 10000, "rate": 25}, {"up_to": 14000, "rate": 30}, {"up_to": null, "rate": 35}]',
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_payroll_settings_touch BEFORE UPDATE ON sms.payroll_settings
FOR EACH ROW EXECUTE FUNCTION sms.touch_updated_at();
INSERT INTO sms.payroll_settings (school_id) SELECT id FROM sms.schools ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION sms.add_payroll_settings() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = sms, public AS $$
BEGIN
  INSERT INTO sms.payroll_settings (school_id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_schools_payroll_settings AFTER INSERT ON sms.schools
FOR EACH ROW EXECUTE FUNCTION sms.add_payroll_settings();

-- Progressive tax: each slice of income is taxed at its bracket's rate.
CREATE OR REPLACE FUNCTION sms.income_tax(_brackets jsonb, _taxable numeric) RETURNS numeric
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE _b jsonb; _lower numeric := 0; _upper numeric; _tax numeric := 0;
BEGIN
  FOR _b IN SELECT * FROM jsonb_array_elements(_brackets) LOOP
    _upper = (_b->>'up_to')::numeric;
    IF _taxable > _lower THEN
      _tax = _tax + (least(_taxable, coalesce(_upper, _taxable)) - _lower) * (_b->>'rate')::numeric / 100;
    END IF;
    EXIT WHEN _upper IS NULL OR _taxable <= _upper;
    _lower = _upper;
  END LOOP;
  RETURN round(_tax, 2);
END $$;

-- Salaries and recurring pay items --------------------------------------------

CREATE TABLE sms.staff_pay (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES sms.schools(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  basic_salary numeric NOT NULL DEFAULT 0 CHECK (basic_salary >= 0),
  pension boolean NOT NULL DEFAULT true,   -- false for staff not covered (e.g. some contract or foreign staff)
  tin text,
  bank_name text,
  bank_account text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, user_id)
);
CREATE TRIGGER trg_staff_pay_touch BEFORE UPDATE ON sms.staff_pay
FOR EACH ROW EXECUTE FUNCTION sms.touch_updated_at();

CREATE TABLE sms.pay_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES sms.schools(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('allowance', 'deduction')),
  name text NOT NULL,
  amount numeric NOT NULL CHECK (amount > 0),
  taxable boolean NOT NULL DEFAULT true,   -- allowances only
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_sms_pay_items_user ON sms.pay_items(school_id, user_id);

-- Pay runs and payslips ------------------------------------------------------
-- A run is one month. Drafts are regenerated freely; a finalized run is locked and its payslips
-- become visible to each staff member.

CREATE TABLE sms.payroll_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES sms.schools(id) ON DELETE CASCADE,
  period date NOT NULL CHECK (extract(day FROM period) = 1),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'finalized')),
  working_days integer,
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  finalized_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  finalized_at timestamptz,
  UNIQUE (school_id, period)
);

CREATE TABLE sms.payslips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES sms.payroll_runs(id) ON DELETE CASCADE,
  school_id uuid NOT NULL REFERENCES sms.schools(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text,
  tin text,
  bank_name text,
  bank_account text,
  basic_salary numeric NOT NULL,
  unpaid_leave_days integer NOT NULL DEFAULT 0,
  unpaid_leave_deduction numeric NOT NULL DEFAULT 0,
  earned_basic numeric NOT NULL,
  allowances jsonb NOT NULL DEFAULT '[]',      -- [{name, amount, taxable}]
  taxable_allowances numeric NOT NULL DEFAULT 0,
  non_taxable_allowances numeric NOT NULL DEFAULT 0,
  gross_pay numeric NOT NULL,
  taxable_income numeric NOT NULL,
  income_tax numeric NOT NULL,
  pension_employee numeric NOT NULL,
  pension_employer numeric NOT NULL,
  deductions jsonb NOT NULL DEFAULT '[]',      -- [{name, amount}]
  other_deductions numeric NOT NULL DEFAULT 0,
  net_pay numeric NOT NULL,
  UNIQUE (run_id, user_id)
);
CREATE INDEX idx_sms_payslips_user ON sms.payslips(school_id, user_id);

-- Builds (or rebuilds) the draft payslips for one month from current salaries, pay items and approved
-- unpaid leave. Returns the run id.
CREATE OR REPLACE FUNCTION sms.generate_payroll(_school_id uuid, _month date)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = sms, public AS $$
DECLARE
  _first date := date_trunc('month', _month)::date;
  _last date := (date_trunc('month', _month) + interval '1 month - 1 day')::date;
  _run sms.payroll_runs; _set sms.payroll_settings; _p sms.staff_pay;
  _wd integer; _unpaid integer; _ded numeric; _earned numeric; _tax_allow numeric; _free_allow numeric;
  _other numeric; _taxable numeric; _tax numeric; _pen_e numeric; _pen_r numeric;
BEGIN
  IF NOT sms.is_admin(_school_id) THEN
    RAISE EXCEPTION 'Only school administrators can run payroll' USING ERRCODE = '42501';
  END IF;
  INSERT INTO sms.payroll_settings (school_id) VALUES (_school_id) ON CONFLICT DO NOTHING;
  SELECT * INTO _set FROM sms.payroll_settings WHERE school_id = _school_id;
  _wd = sms.school_working_days(_school_id, _first, _last);

  INSERT INTO sms.payroll_runs (school_id, period) VALUES (_school_id, _first)
  ON CONFLICT (school_id, period) DO NOTHING;
  SELECT * INTO _run FROM sms.payroll_runs WHERE school_id = _school_id AND period = _first FOR UPDATE;
  IF _run.status = 'finalized' THEN
    RAISE EXCEPTION 'Payroll for % is finalized and cannot be changed', to_char(_first, 'FMMonth YYYY') USING ERRCODE = '22023';
  END IF;
  UPDATE sms.payroll_runs SET working_days = _wd WHERE id = _run.id;
  DELETE FROM sms.payslips WHERE run_id = _run.id;

  -- Everyone with a salary who is still staff at this school.
  FOR _p IN
    SELECT sp.* FROM sms.staff_pay sp
    WHERE sp.school_id = _school_id AND sp.basic_salary > 0
      AND EXISTS (SELECT 1 FROM sms.school_members m WHERE m.school_id = _school_id AND m.user_id = sp.user_id
                    AND m.role IN ('school_admin', 'teacher', 'registrar'))
  LOOP
    SELECT coalesce(sum(sms.school_working_days(_school_id, greatest(r.start_date, _first), least(r.end_date, _last))), 0)
    INTO _unpaid
    FROM sms.leave_requests r JOIN sms.leave_types t ON t.id = r.leave_type_id
    WHERE r.school_id = _school_id AND r.user_id = _p.user_id AND r.status = 'approved' AND NOT t.paid
      AND r.start_date <= _last AND r.end_date >= _first;

    _ded = CASE WHEN _wd > 0 THEN least(round(_p.basic_salary / _wd * _unpaid, 2), _p.basic_salary) ELSE 0 END;
    _earned = _p.basic_salary - _ded;
    SELECT coalesce(sum(amount) FILTER (WHERE kind = 'allowance' AND taxable), 0),
           coalesce(sum(amount) FILTER (WHERE kind = 'allowance' AND NOT taxable), 0),
           coalesce(sum(amount) FILTER (WHERE kind = 'deduction'), 0)
    INTO _tax_allow, _free_allow, _other
    FROM sms.pay_items WHERE school_id = _school_id AND user_id = _p.user_id;

    _taxable = _earned + _tax_allow;
    _tax = sms.income_tax(_set.tax_brackets, _taxable);
    _pen_e = CASE WHEN _p.pension THEN round(_earned * _set.employee_pension_rate / 100, 2) ELSE 0 END;
    _pen_r = CASE WHEN _p.pension THEN round(_earned * _set.employer_pension_rate / 100, 2) ELSE 0 END;

    INSERT INTO sms.payslips (run_id, school_id, user_id, full_name, tin, bank_name, bank_account,
      basic_salary, unpaid_leave_days, unpaid_leave_deduction, earned_basic,
      allowances, taxable_allowances, non_taxable_allowances, gross_pay, taxable_income, income_tax,
      pension_employee, pension_employer, deductions, other_deductions, net_pay)
    VALUES (_run.id, _school_id, _p.user_id,
      (SELECT coalesce(max(full_name), max(email)) FROM sms.school_members WHERE school_id = _school_id AND user_id = _p.user_id),
      _p.tin, _p.bank_name, _p.bank_account,
      _p.basic_salary, _unpaid, _ded, _earned,
      coalesce((SELECT jsonb_agg(jsonb_build_object('name', name, 'amount', amount, 'taxable', taxable) ORDER BY name)
                FROM sms.pay_items WHERE school_id = _school_id AND user_id = _p.user_id AND kind = 'allowance'), '[]'),
      _tax_allow, _free_allow, _earned + _tax_allow + _free_allow, _taxable, _tax, _pen_e, _pen_r,
      coalesce((SELECT jsonb_agg(jsonb_build_object('name', name, 'amount', amount) ORDER BY name)
                FROM sms.pay_items WHERE school_id = _school_id AND user_id = _p.user_id AND kind = 'deduction'), '[]'),
      _other, _earned + _tax_allow + _free_allow - _tax - _pen_e - _other);
  END LOOP;
  RETURN _run.id;
END $$;

CREATE OR REPLACE FUNCTION sms.finalize_payroll(_run_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = sms, public AS $$
DECLARE _run sms.payroll_runs;
BEGIN
  SELECT * INTO _run FROM sms.payroll_runs WHERE id = _run_id FOR UPDATE;
  IF _run.id IS NULL OR NOT sms.is_admin(_run.school_id) THEN
    RAISE EXCEPTION 'Only school administrators can finalize payroll' USING ERRCODE = '42501';
  END IF;
  IF _run.status = 'finalized' THEN
    RAISE EXCEPTION 'Already finalized' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM sms.payslips WHERE run_id = _run_id) THEN
    RAISE EXCEPTION 'There are no payslips to finalize' USING ERRCODE = '22023';
  END IF;
  UPDATE sms.payroll_runs SET status = 'finalized', finalized_by = auth.uid(), finalized_at = now() WHERE id = _run_id;
END $$;

-- Access -------------------------------------------------------------------
-- Pay data: administrators, plus each person's own salary record and finalized payslips.

ALTER TABLE sms.payroll_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms.staff_pay ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms.pay_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms.payroll_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms.payslips ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins" ON sms.payroll_settings FOR ALL TO authenticated
  USING (sms.is_admin(school_id)) WITH CHECK (sms.is_admin(school_id));

CREATE POLICY "admins or self read" ON sms.staff_pay FOR SELECT TO authenticated
  USING (sms.is_admin(school_id) OR user_id = auth.uid());
CREATE POLICY "admins write" ON sms.staff_pay FOR ALL TO authenticated
  USING (sms.is_admin(school_id)) WITH CHECK (sms.is_admin(school_id));

CREATE POLICY "admins or self read" ON sms.pay_items FOR SELECT TO authenticated
  USING (sms.is_admin(school_id) OR user_id = auth.uid());
CREATE POLICY "admins write" ON sms.pay_items FOR ALL TO authenticated
  USING (sms.is_admin(school_id)) WITH CHECK (sms.is_admin(school_id));

CREATE POLICY "admins read, staff read finalized" ON sms.payroll_runs FOR SELECT TO authenticated
  USING (sms.is_admin(school_id) OR (status = 'finalized' AND sms.is_staff(school_id)));
-- Deleting a draft run is allowed; changes otherwise go through generate_payroll and finalize_payroll.
CREATE POLICY "admins delete drafts" ON sms.payroll_runs FOR DELETE TO authenticated
  USING (sms.is_admin(school_id) AND status = 'draft');

CREATE POLICY "admins or own finalized" ON sms.payslips FOR SELECT TO authenticated
  USING (sms.is_admin(school_id)
         OR (user_id = auth.uid() AND EXISTS (SELECT 1 FROM sms.payroll_runs r WHERE r.id = run_id AND r.status = 'finalized')));

GRANT SELECT, INSERT, UPDATE, DELETE ON sms.staff_evaluations, sms.payroll_settings, sms.staff_pay, sms.pay_items TO authenticated;
GRANT SELECT, DELETE ON sms.payroll_runs TO authenticated;
GRANT SELECT ON sms.payslips TO authenticated;
GRANT ALL ON sms.staff_evaluations, sms.payroll_settings, sms.staff_pay, sms.pay_items, sms.payroll_runs, sms.payslips TO service_role;
REVOKE ALL ON FUNCTION sms.evaluation_overall, sms.acknowledge_evaluation, sms.add_payroll_settings, sms.income_tax,
  sms.generate_payroll, sms.finalize_payroll FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION sms.acknowledge_evaluation, sms.income_tax, sms.generate_payroll, sms.finalize_payroll
  TO authenticated, service_role;
