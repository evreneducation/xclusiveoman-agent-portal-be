import { Router } from 'express';
import * as ticketsController from '../controllers/supportTicketsAgent.controller.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validateBody, createTicketSchema, ticketMessageSchema } from '../validation/schemas.js';

const router = Router();

// Agent Support & Helpdesk (Task 18 — Screen 27, SUP-1/SUP-3). Mounted at
// /api/support/tickets — same existing agency_owner/agency_staff gate every
// other agent-facing router in this codebase uses.
router.use(requireAuth, requireRole('agency_owner', 'agency_staff'));

router.get('/', ticketsController.listMyTickets);
router.post('/', validateBody(createTicketSchema), ticketsController.createMyTicket);
router.post('/:id/messages', validateBody(ticketMessageSchema), ticketsController.replyToMyTicket);

export default router;
