-- Admin Quote Inbox task requires that assigning a Lead Manager (FIT-8)
-- updates the request's pipeline status. The existing package_request_status
-- enum (submitted, costed, published, ...) has no state for "submitted and a
-- lead manager is now assigned, awaiting costing" — this adds it between the
-- two so the pipeline reads: submitted -> assigned -> costed -> published.
ALTER TYPE package_request_status ADD VALUE 'assigned' AFTER 'submitted';
