-- Financial management: fee structures, invoices, payments, discounts, expenses and budgets.
-- Run after 20261119000000_sms_accountant_role.sql.

-- Accountant access --------------------------------------------------------------
-- Accountants are staff (staff register, leave, payslips, reading student records) and, like administrators,
-- manage school finances. They cannot change setup, people, grades, attendance or payroll.

CREATE OR REPLACE FUNCTION sms.is_staff(_school_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = sms, public AS $$
  SELECT sms.has_school_role(_school_id, ARRAY['school_admin', 'teacher', 'registrar', 'accountant']::sms.school_role[])
$$;

CREATE OR REPLACE FUNCTION sms.manages_finance(_school_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = sms, public AS $$
  SELECT sms.has_school_role(_school_id, ARRAY['school_admin', 'accountant']::sms.school_role[])
$$;

-- Numbering: "<school code>-INV-0001" and "<school code>-RCP-0001" (without the code when the school has none).
ALTER TABLE sms.schools
  ADD COLUMN next_invoice_number integer NOT NULL DEFAULT 1,
  ADD COLUMN next_receipt_number integer NOT NULL DEFAULT 1;

CREATE OR REPLACE FUNCTION sms.next_document_number(_school_id uuid, _kind text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = sms, public AS $$
DECLARE _n integer; _code text;
BEGIN
  IF _kind = 'INV' THEN
    UPDATE sms.schools SET next_invoice_number = next_invoice_number + 1 WHERE id = _school_id
    RETURNING next_invoice_number - 1, code INTO _n, _code;
  ELSE
    UPDATE sms.schools SET next_receipt_number = next_receipt_number + 1 WHERE id = _school_id
    RETURNING next_receipt_number - 1, code INTO _n, _code;
  END IF;
  RETURN coalesce(nullif(trim(_code), '') || '-', '') || _kind || '-' || lpad(_n::text, 4, '0');
END $$;

-- Fee structures ---------------------------------------------------------------------
-- One per year and grade (grade NULL = every grade without its own structure).

CREATE TABLE sms.fee_structures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES sms.schools(id) ON DELETE CASCADE,
  academic_year_id uuid NOT NULL REFERENCES sms.academic_years(id) ON DELETE CASCADE,
  grade_level integer CHECK (grade_level BETWEEN 0 AND 12),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_sms_fee_structure_grade ON sms.fee_structures(academic_year_id, coalesce(grade_level, -1));

CREATE TABLE sms.fee_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES sms.schools(id) ON DELETE CASCADE,
  structure_id uuid NOT NULL REFERENCES sms.fee_structures(id) ON DELETE CASCADE,
  name text NOT NULL,                 -- e.g. 'Tuition', 'Registration', 'Transport'
  kind text NOT NULL DEFAULT 'tuition' CHECK (kind IN ('tuition', 'registration', 'other')),
  frequency text NOT NULL DEFAULT 'monthly' CHECK (frequency IN ('once', 'per_term', 'monthly')),
  amount numeric NOT NULL CHECK (amount > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Scholarships and discounts -----------------------------------------------------------

CREATE TABLE sms.student_discounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES sms.schools(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES sms.students(id) ON DELETE CASCADE,
  academic_year_id uuid NOT NULL REFERENCES sms.academic_years(id) ON DELETE CASCADE,
  name text NOT NULL,                 -- e.g. 'Sibling discount', 'Full scholarship'
  kind text NOT NULL CHECK (kind IN ('percent', 'fixed')),
  value numeric NOT NULL CHECK (value > 0),
  applies_to text NOT NULL DEFAULT 'tuition' CHECK (applies_to IN ('tuition', 'all')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (kind <> 'percent' OR value <= 100)
);
CREATE INDEX idx_sms_discounts_student ON sms.student_discounts(student_id, academic_year_id);

-- Invoices ---------------------------------------------------------------------------

CREATE TABLE sms.invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES sms.schools(id) ON DELETE CASCADE,
  academic_year_id uuid REFERENCES sms.academic_years(id) ON DELETE SET NULL,
  student_id uuid NOT NULL REFERENCES sms.students(id) ON DELETE CASCADE,
  number text NOT NULL,
  title text NOT NULL,               -- e.g. 'Tuition · November 2026'
  -- Billing run it came from ('2026-11', a term id, 'once'); NULL for invoices made by hand.
  period_key text,
  issued_on date NOT NULL DEFAULT current_date,
  due_on date,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'void')),
  void_reason text,
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, number)
);
CREATE UNIQUE INDEX uq_sms_invoice_period ON sms.invoices(student_id, academic_year_id, period_key)
  WHERE period_key IS NOT NULL AND status <> 'void';
CREATE INDEX idx_sms_invoices_student ON sms.invoices(student_id);

CREATE TABLE sms.invoice_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES sms.schools(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES sms.invoices(id) ON DELETE CASCADE,
  description text NOT NULL,
  kind text NOT NULL DEFAULT 'other' CHECK (kind IN ('tuition', 'registration', 'other', 'discount')),
  amount numeric NOT NULL,            -- negative for discounts
  fee_item_id uuid REFERENCES sms.fee_items(id) ON DELETE SET NULL,
  discount_id uuid REFERENCES sms.student_discounts(id) ON DELETE SET NULL,
  CHECK ((kind = 'discount') = (amount < 0))
);
CREATE INDEX idx_sms_lines_invoice ON sms.invoice_lines(invoice_id);

CREATE OR REPLACE FUNCTION sms.assign_invoice_number() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = sms, public AS $$
BEGIN
  NEW.number = sms.next_document_number(NEW.school_id, 'INV');
  RETURN NEW;
END $$;
CREATE TRIGGER trg_invoices_number BEFORE INSERT ON sms.invoices
FOR EACH ROW EXECUTE FUNCTION sms.assign_invoice_number();

-- Payments -----------------------------------------------------------------------------
-- Never deleted or edited: a mistake is voided with a reason and entered again.

CREATE TABLE sms.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES sms.schools(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES sms.invoices(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES sms.students(id) ON DELETE CASCADE,
  receipt_number text NOT NULL,
  amount numeric NOT NULL CHECK (amount > 0),
  paid_on date NOT NULL DEFAULT current_date,
  method text NOT NULL DEFAULT 'cash' CHECK (method IN ('cash', 'bank', 'telebirr', 'cbe_birr', 'cheque', 'other')),
  reference text,
  received_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  voided boolean NOT NULL DEFAULT false,
  void_reason text,
  voided_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, receipt_number)
);
CREATE INDEX idx_sms_payments_invoice ON sms.payments(invoice_id);
CREATE INDEX idx_sms_payments_date ON sms.payments(school_id, paid_on);

-- Balances --------------------------------------------------------------------------------

CREATE VIEW sms.invoice_balances WITH (security_invoker = true) AS
SELECT i.id AS invoice_id, i.school_id, i.student_id, i.academic_year_id, i.number, i.title, i.issued_on, i.due_on,
       i.status AS invoice_status,
       coalesce(l.total, 0) AS total,
       coalesce(p.paid, 0) AS paid,
       CASE WHEN i.status = 'void' THEN 0 ELSE coalesce(l.total, 0) - coalesce(p.paid, 0) END AS balance,
       CASE
         WHEN i.status = 'void' THEN 'void'
         WHEN coalesce(l.total, 0) - coalesce(p.paid, 0) <= 0 THEN 'paid'
         WHEN i.due_on < current_date THEN 'overdue'
         WHEN coalesce(p.paid, 0) > 0 THEN 'partial'
         ELSE 'unpaid' END AS state
FROM sms.invoices i
LEFT JOIN (SELECT invoice_id, sum(amount) AS total FROM sms.invoice_lines GROUP BY invoice_id) l ON l.invoice_id = i.id
LEFT JOIN (SELECT invoice_id, sum(amount) AS paid FROM sms.payments WHERE NOT voided GROUP BY invoice_id) p ON p.invoice_id = i.id;

CREATE OR REPLACE FUNCTION sms.check_payment() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = sms, public AS $$
DECLARE _i sms.invoices; _balance numeric;
BEGIN
  SELECT * INTO _i FROM sms.invoices WHERE id = NEW.invoice_id FOR UPDATE;
  IF _i.school_id <> NEW.school_id OR _i.student_id <> NEW.student_id THEN
    RAISE EXCEPTION 'The payment does not match its invoice' USING ERRCODE = '22023';
  END IF;
  IF _i.status = 'void' THEN
    RAISE EXCEPTION 'Invoice % is void' , _i.number USING ERRCODE = '22023';
  END IF;
  SELECT balance INTO _balance FROM sms.invoice_balances WHERE invoice_id = NEW.invoice_id;
  IF NEW.amount > _balance THEN
    RAISE EXCEPTION 'That is more than the % still owed on %', to_char(_balance, 'FM999,999,990.00'), _i.number USING ERRCODE = '23514';
  END IF;
  NEW.receipt_number = sms.next_document_number(NEW.school_id, 'RCP');
  NEW.voided = false;
  NEW.void_reason = NULL;
  NEW.voided_by = NULL;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_payments_check BEFORE INSERT ON sms.payments
FOR EACH ROW EXECUTE FUNCTION sms.check_payment();

-- Lines can change only while nothing has been paid on the invoice.
CREATE OR REPLACE FUNCTION sms.guard_invoice_lines() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = sms, public AS $$
DECLARE _inv uuid := coalesce(NEW.invoice_id, OLD.invoice_id);
BEGIN
  -- Deleting a student or school removes its invoices first; their lines then go too.
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM sms.invoices WHERE id = _inv) THEN
    RETURN OLD;
  END IF;
  IF EXISTS (SELECT 1 FROM sms.invoices WHERE id = _inv AND status = 'void') THEN
    RAISE EXCEPTION 'The invoice is void' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM sms.payments WHERE invoice_id = _inv AND NOT voided) THEN
    RAISE EXCEPTION 'The invoice has payments; void them before changing its lines' USING ERRCODE = '22023';
  END IF;
  RETURN coalesce(NEW, OLD);
END $$;
CREATE TRIGGER trg_invoice_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON sms.invoice_lines
FOR EACH ROW EXECUTE FUNCTION sms.guard_invoice_lines();

CREATE OR REPLACE FUNCTION sms.void_invoice(_invoice_id uuid, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = sms, public AS $$
DECLARE _i sms.invoices;
BEGIN
  SELECT * INTO _i FROM sms.invoices WHERE id = _invoice_id FOR UPDATE;
  IF _i.id IS NULL OR NOT sms.manages_finance(_i.school_id) THEN
    RAISE EXCEPTION 'Only administrators and accountants can void invoices' USING ERRCODE = '42501';
  END IF;
  IF nullif(trim(_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Give a reason for voiding' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM sms.payments WHERE invoice_id = _invoice_id AND NOT voided) THEN
    RAISE EXCEPTION 'The invoice has payments; void them first' USING ERRCODE = '22023';
  END IF;
  UPDATE sms.invoices SET status = 'void', void_reason = trim(_reason) WHERE id = _invoice_id;
END $$;

CREATE OR REPLACE FUNCTION sms.void_payment(_payment_id uuid, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = sms, public AS $$
DECLARE _p sms.payments;
BEGIN
  SELECT * INTO _p FROM sms.payments WHERE id = _payment_id FOR UPDATE;
  IF _p.id IS NULL OR NOT sms.manages_finance(_p.school_id) THEN
    RAISE EXCEPTION 'Only administrators and accountants can void payments' USING ERRCODE = '42501';
  END IF;
  IF _p.voided THEN
    RAISE EXCEPTION 'Receipt % is already void', _p.receipt_number USING ERRCODE = '22023';
  END IF;
  IF nullif(trim(_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Give a reason for voiding' USING ERRCODE = '22023';
  END IF;
  UPDATE sms.payments SET voided = true, void_reason = trim(_reason), voided_by = auth.uid() WHERE id = _payment_id;
END $$;

-- Billing run: invoices every enrolled student of a year for the fee lines of one frequency.
-- _period_key makes it safe to run again ('2026-11' for a month, the term id for a term, 'once' for one-off fees).
-- One-off fees a student was already billed for are skipped. Discounts become negative lines.
-- Returns the number of invoices created.
CREATE OR REPLACE FUNCTION sms.generate_invoices(_year_id uuid, _frequency text, _period_key text, _title text, _due_on date)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = sms, public AS $$
DECLARE
  _school uuid; _e record; _structure uuid; _invoice uuid; _count integer := 0;
  _d sms.student_discounts; _base numeric; _off numeric;
BEGIN
  SELECT school_id INTO _school FROM sms.academic_years WHERE id = _year_id;
  IF _school IS NULL OR NOT sms.manages_finance(_school) THEN
    RAISE EXCEPTION 'Only administrators and accountants can create invoices' USING ERRCODE = '42501';
  END IF;
  IF _frequency NOT IN ('once', 'per_term', 'monthly') OR nullif(trim(_period_key), '') IS NULL THEN
    RAISE EXCEPTION 'Choose what to bill' USING ERRCODE = '22023';
  END IF;

  FOR _e IN
    SELECT DISTINCT ON (s.id) s.id AS student_id, c.grade_level
    FROM sms.enrollments en
    JOIN sms.classes c ON c.id = en.class_id AND c.academic_year_id = _year_id
    JOIN sms.students s ON s.id = en.student_id AND s.status = 'active'
    WHERE en.status = 'active'
    ORDER BY s.id
  LOOP
    CONTINUE WHEN EXISTS (SELECT 1 FROM sms.invoices WHERE student_id = _e.student_id AND academic_year_id = _year_id
                            AND period_key = _period_key AND status <> 'void');
    SELECT id INTO _structure FROM sms.fee_structures
    WHERE academic_year_id = _year_id AND (grade_level = _e.grade_level OR grade_level IS NULL)
    ORDER BY grade_level NULLS LAST LIMIT 1;
    CONTINUE WHEN _structure IS NULL;
    CONTINUE WHEN NOT EXISTS (
      SELECT 1 FROM sms.fee_items f WHERE f.structure_id = _structure AND f.frequency = _frequency
        AND NOT (f.frequency = 'once' AND EXISTS (
          SELECT 1 FROM sms.invoice_lines l JOIN sms.invoices i ON i.id = l.invoice_id
          WHERE l.fee_item_id = f.id AND i.student_id = _e.student_id AND i.status <> 'void')));

    INSERT INTO sms.invoices (school_id, academic_year_id, student_id, title, period_key, due_on, number)
    VALUES (_school, _year_id, _e.student_id, _title, _period_key, _due_on, '')
    RETURNING id INTO _invoice;

    INSERT INTO sms.invoice_lines (school_id, invoice_id, description, kind, amount, fee_item_id)
    SELECT _school, _invoice, f.name, f.kind, f.amount, f.id
    FROM sms.fee_items f
    WHERE f.structure_id = _structure AND f.frequency = _frequency
      AND NOT (f.frequency = 'once' AND EXISTS (
        SELECT 1 FROM sms.invoice_lines l JOIN sms.invoices i ON i.id = l.invoice_id
        WHERE l.fee_item_id = f.id AND i.student_id = _e.student_id AND i.status <> 'void' AND i.id <> _invoice));

    FOR _d IN SELECT * FROM sms.student_discounts WHERE student_id = _e.student_id AND academic_year_id = _year_id ORDER BY created_at LOOP
      SELECT coalesce(sum(amount), 0) INTO _base FROM sms.invoice_lines
      WHERE invoice_id = _invoice AND kind <> 'discount' AND (_d.applies_to = 'all' OR kind = 'tuition');
      -- Never discount below zero, also when several discounts add up.
      _base = least(_base, (SELECT coalesce(sum(amount), 0) FROM sms.invoice_lines WHERE invoice_id = _invoice));
      _off = round(CASE WHEN _d.kind = 'percent' THEN _base * _d.value / 100 ELSE least(_d.value, _base) END, 2);
      IF _off > 0 THEN
        INSERT INTO sms.invoice_lines (school_id, invoice_id, description, kind, amount, discount_id)
        VALUES (_school, _invoice, _d.name, 'discount', -_off, _d.id);
      END IF;
    END LOOP;
    _count = _count + 1;
  END LOOP;
  RETURN _count;
END $$;

-- Expenses and budgets ----------------------------------------------------------------

CREATE TABLE sms.budget_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES sms.schools(id) ON DELETE CASCADE,
  academic_year_id uuid NOT NULL REFERENCES sms.academic_years(id) ON DELETE CASCADE,
  category text NOT NULL,             -- e.g. 'Utilities', 'Supplies', 'Maintenance'
  amount numeric NOT NULL CHECK (amount >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_sms_budget_category ON sms.budget_lines(academic_year_id, lower(category));

CREATE TABLE sms.expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES sms.schools(id) ON DELETE CASCADE,
  academic_year_id uuid REFERENCES sms.academic_years(id) ON DELETE SET NULL,
  category text NOT NULL,
  description text NOT NULL,
  amount numeric NOT NULL CHECK (amount > 0),
  spent_on date NOT NULL DEFAULT current_date,
  paid_to text,
  method text NOT NULL DEFAULT 'cash' CHECK (method IN ('cash', 'bank', 'telebirr', 'cbe_birr', 'cheque', 'other')),
  reference text,
  recorded_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_sms_expenses_date ON sms.expenses(school_id, spent_on);

-- Finalized payroll per month, so reports count salaries without copying them into expenses.
CREATE VIEW sms.payroll_costs WITH (security_invoker = true) AS
SELECT r.school_id, r.period,
       sum(p.gross_pay) AS gross_pay,
       sum(p.pension_employer) AS employer_pension,
       sum(p.gross_pay + p.pension_employer) AS total_cost
FROM sms.payroll_runs r JOIN sms.payslips p ON p.run_id = r.id
WHERE r.status = 'finalized'
GROUP BY r.school_id, r.period;

-- Accountants are paid staff and can invigilate: add them to the staff lists of these two functions.
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
                    AND m.role IN ('school_admin', 'teacher', 'registrar', 'accountant'))
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

CREATE OR REPLACE FUNCTION sms.check_invigilator() RETURNS trigger
LANGUAGE plpgsql SET search_path = sms, public AS $$
DECLARE _s sms.exam_sittings; _clash text;
BEGIN
  SELECT * INTO _s FROM sms.exam_sittings WHERE id = NEW.sitting_id;
  NEW.school_id = _s.school_id;
  IF NOT EXISTS (
    SELECT 1 FROM sms.school_members WHERE school_id = _s.school_id AND user_id = NEW.user_id
      AND role IN ('school_admin', 'teacher', 'registrar', 'accountant')) THEN
    RAISE EXCEPTION 'Invigilators must be staff of this school' USING ERRCODE = '22023';
  END IF;
  _clash = sms.sitting_clash(_s.id, _s.school_id, _s.date, _s.starts_at, _s.ends_at, _s.class_id, NULL, NEW.user_id);
  IF _clash IS NOT NULL THEN
    RAISE EXCEPTION '%', _clash USING ERRCODE = '23P01';
  END IF;
  RETURN NEW;
END $$;

-- Access ---------------------------------------------------------------------------------

ALTER TABLE sms.fee_structures ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms.fee_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms.student_discounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms.invoice_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms.budget_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms.expenses ENABLE ROW LEVEL SECURITY;

-- Fee structures are public within the school (parents can see what fees are).
CREATE POLICY "members read" ON sms.fee_structures FOR SELECT TO authenticated
  USING (sms.has_school_role(school_id, enum_range(NULL::sms.school_role)));
CREATE POLICY "finance write" ON sms.fee_structures FOR ALL TO authenticated
  USING (sms.manages_finance(school_id)) WITH CHECK (sms.manages_finance(school_id));
CREATE POLICY "members read" ON sms.fee_items FOR SELECT TO authenticated
  USING (sms.has_school_role(school_id, enum_range(NULL::sms.school_role)));
CREATE POLICY "finance write" ON sms.fee_items FOR ALL TO authenticated
  USING (sms.manages_finance(school_id)) WITH CHECK (sms.manages_finance(school_id));

-- A family's own records: discounts, invoices, lines and payments of their children.
CREATE POLICY "finance or family read" ON sms.student_discounts FOR SELECT TO authenticated
  USING (sms.manages_finance(school_id) OR sms.is_guardian_of(student_id));
CREATE POLICY "finance write" ON sms.student_discounts FOR ALL TO authenticated
  USING (sms.manages_finance(school_id)) WITH CHECK (sms.manages_finance(school_id));

CREATE POLICY "finance or family read" ON sms.invoices FOR SELECT TO authenticated
  USING (sms.manages_finance(school_id) OR sms.is_guardian_of(student_id));
CREATE POLICY "finance create" ON sms.invoices FOR INSERT TO authenticated
  WITH CHECK (sms.manages_finance(school_id) AND status = 'open');
-- Only the due date and title change directly; voiding goes through sms.void_invoice.
CREATE POLICY "finance edit open" ON sms.invoices FOR UPDATE TO authenticated
  USING (sms.manages_finance(school_id) AND status = 'open')
  WITH CHECK (sms.manages_finance(school_id) AND status = 'open');

CREATE POLICY "finance or family read" ON sms.invoice_lines FOR SELECT TO authenticated
  USING (sms.manages_finance(school_id) OR EXISTS (SELECT 1 FROM sms.invoices i WHERE i.id = invoice_id AND sms.is_guardian_of(i.student_id)));
CREATE POLICY "finance write" ON sms.invoice_lines FOR ALL TO authenticated
  USING (sms.manages_finance(school_id)) WITH CHECK (sms.manages_finance(school_id));

CREATE POLICY "finance or family read" ON sms.payments FOR SELECT TO authenticated
  USING (sms.manages_finance(school_id) OR sms.is_guardian_of(student_id));
CREATE POLICY "finance record" ON sms.payments FOR INSERT TO authenticated
  WITH CHECK (sms.manages_finance(school_id));

CREATE POLICY "finance" ON sms.budget_lines FOR ALL TO authenticated
  USING (sms.manages_finance(school_id)) WITH CHECK (sms.manages_finance(school_id));
CREATE POLICY "finance" ON sms.expenses FOR ALL TO authenticated
  USING (sms.manages_finance(school_id)) WITH CHECK (sms.manages_finance(school_id));

-- Accountants see finalized payroll totals for reports (not individual payslips).
CREATE OR REPLACE FUNCTION sms.payroll_totals(_school_id uuid, _from date, _to date)
RETURNS TABLE (period date, gross_pay numeric, employer_pension numeric, total_cost numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = sms, public AS $$
BEGIN
  IF NOT sms.manages_finance(_school_id) THEN
    RAISE EXCEPTION 'Only administrators and accountants can see payroll totals' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT c.period, c.gross_pay, c.employer_pension, c.total_cost FROM sms.payroll_costs c
  WHERE c.school_id = _school_id AND c.period BETWEEN _from AND _to ORDER BY c.period;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON sms.fee_structures, sms.fee_items, sms.student_discounts, sms.invoice_lines,
  sms.budget_lines, sms.expenses TO authenticated;
GRANT SELECT, INSERT, UPDATE ON sms.invoices TO authenticated;
GRANT SELECT, INSERT ON sms.payments TO authenticated;
GRANT SELECT ON sms.invoice_balances TO authenticated;
GRANT ALL ON sms.fee_structures, sms.fee_items, sms.student_discounts, sms.invoices, sms.invoice_lines, sms.payments,
  sms.budget_lines, sms.expenses TO service_role;
GRANT SELECT ON sms.invoice_balances, sms.payroll_costs TO service_role;
REVOKE ALL ON FUNCTION sms.manages_finance, sms.next_document_number, sms.assign_invoice_number, sms.check_payment,
  sms.guard_invoice_lines, sms.void_invoice, sms.void_payment, sms.generate_invoices, sms.payroll_totals FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION sms.manages_finance, sms.void_invoice, sms.void_payment, sms.generate_invoices, sms.payroll_totals
  TO authenticated, service_role;
