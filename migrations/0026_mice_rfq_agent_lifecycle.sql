-- Agent MICE Request & Proposal Workflow. Drafts (item 1) need a 'draft'
-- pipeline state — mice_rfq_status only had submitted..converted (Task 1/2
-- never needed one); Request Revision (item 5) needs a 'revision_requested'
-- state — neither existed until now. Both mirror package_request_status
-- exactly (0016/0017).
ALTER TYPE mice_rfq_status ADD VALUE 'draft' BEFORE 'submitted';
ALTER TYPE mice_rfq_status ADD VALUE 'revision_requested' AFTER 'published';

-- Drafts (item 1): a half-built MICE request may not have event dates,
-- group size, or a destination chosen yet — same nullability relief
-- package_requests.date_from/date_to got for its own draft flow (0022).
-- destination stays NOT NULL; the draft schema defaults it to '' instead,
-- same as package_requests.destination.
ALTER TABLE mice_rfqs
  ALTER COLUMN group_size DROP NOT NULL,
  ALTER COLUMN event_date_from DROP NOT NULL,
  ALTER COLUMN event_date_to DROP NOT NULL;
