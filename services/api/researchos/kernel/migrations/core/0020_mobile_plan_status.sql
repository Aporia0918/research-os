-- core 0020 (mobile-guidance): why a plan has no paper items. 'ok' = a Methods-like section was found by heading;
-- 'method_section_not_found' = none was found, so the drafter returned no items instead of guessing.
ALTER TABLE mobile_plans ADD COLUMN section_status TEXT NOT NULL DEFAULT 'ok';
