-- Fixes from the first browser test pass.
-- Run after 20261117000000_sms_academics.sql.

-- Exam clash messages already name the clashing times; drop the trailing "at that time".
CREATE OR REPLACE FUNCTION sms.check_sitting() RETURNS trigger
LANGUAGE plpgsql SET search_path = sms, public AS $$
DECLARE _p sms.exam_periods; _clash text; _inv uuid;
BEGIN
  SELECT * INTO _p FROM sms.exam_periods WHERE id = NEW.exam_period_id;
  IF _p.school_id <> NEW.school_id THEN
    RAISE EXCEPTION 'Unknown exam period' USING ERRCODE = '22023';
  END IF;
  IF NEW.date NOT BETWEEN _p.starts_on AND _p.ends_on THEN
    RAISE EXCEPTION 'The date must be within % (% to %)', _p.name, _p.starts_on, _p.ends_on USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM sms.class_subjects WHERE id = NEW.class_subject_id AND class_id = NEW.class_id) THEN
    RAISE EXCEPTION 'That subject is not taught in this class' USING ERRCODE = '22023';
  END IF;
  NEW.room = nullif(trim(NEW.room), '');
  _clash = sms.sitting_clash(NEW.id, NEW.school_id, NEW.date, NEW.starts_at, NEW.ends_at, NEW.class_id, NEW.room, NULL);
  IF _clash IS NULL AND TG_OP = 'UPDATE' THEN
    FOR _inv IN SELECT user_id FROM sms.exam_invigilators WHERE sitting_id = NEW.id LOOP
      _clash = sms.sitting_clash(NEW.id, NEW.school_id, NEW.date, NEW.starts_at, NEW.ends_at, NEW.class_id, NULL, _inv);
      EXIT WHEN _clash IS NOT NULL;
    END LOOP;
  END IF;
  IF _clash IS NOT NULL THEN
    RAISE EXCEPTION '%', _clash USING ERRCODE = '23P01';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION sms.check_invigilator() RETURNS trigger
LANGUAGE plpgsql SET search_path = sms, public AS $$
DECLARE _s sms.exam_sittings; _clash text;
BEGIN
  SELECT * INTO _s FROM sms.exam_sittings WHERE id = NEW.sitting_id;
  NEW.school_id = _s.school_id;
  IF NOT EXISTS (
    SELECT 1 FROM sms.school_members WHERE school_id = _s.school_id AND user_id = NEW.user_id
      AND role IN ('school_admin', 'teacher', 'registrar')) THEN
    RAISE EXCEPTION 'Invigilators must be staff of this school' USING ERRCODE = '22023';
  END IF;
  _clash = sms.sitting_clash(_s.id, _s.school_id, _s.date, _s.starts_at, _s.ends_at, _s.class_id, NULL, NEW.user_id);
  IF _clash IS NOT NULL THEN
    RAISE EXCEPTION '%', _clash USING ERRCODE = '23P01';
  END IF;
  RETURN NEW;
END $$;
