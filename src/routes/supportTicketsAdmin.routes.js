import { Router } from 'express';
import * as ticketsAdminController from '../controllers/supportTicketsAdmin.controller.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validateBody, ticketMessageSchema, updateTicketSchema } from '../validation/schemas.js';

const router = Router();

// Admin Support & Helpdesk (Task 18 — Screen 28, SUP-2/SUP-3). Its own RBAC
// gate, independent of every other admin feature — support+super_admin,
// per the documentation's own role scoping (§4: "Finance / Support /
// Sales-Marketing... [scoped to] NEFT verification, helpdesk, and
// campaigns respectively").
router.use(requireAuth, requireRole('support', 'super_admin'));

// Literal path before the :id routes — same ordering
// packageRequestsAdmin.routes.js already uses for its own
// lead-manager-candidates route, so Express never tries to match this
// against :id.
router.get('/assignment-candidates', ticketsAdminController.listAssignmentCandidates);

router.get('/', ticketsAdminController.listTickets);
router.get('/:id', ticketsAdminController.getTicket);
router.patch('/:id', validateBody(updateTicketSchema), ticketsAdminController.updateTicket);
router.post('/:id/messages', validateBody(ticketMessageSchema), ticketsAdminController.replyToTicket);

export default router;
