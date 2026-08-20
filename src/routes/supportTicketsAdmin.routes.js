import { Router } from 'express';
import * as ticketsAdminController from '../controllers/supportTicketsAdmin.controller.js';
import { requireAuth, requireRole, requireFeature } from '../middleware/auth.js';
import { validateBody, ticketMessageSchema, updateTicketSchema } from '../validation/schemas.js';

const router = Router();

// Admin Support & Helpdesk (Task 18 — Screen 28, SUP-2/SUP-3). Its own RBAC
// gate, independent of every other admin feature — support+super_admin,
// per the documentation's own role scoping (§4: "Finance / Support /
// Sales-Marketing... [scoped to] NEFT verification, helpdesk, and
// campaigns respectively"). Widened to also admit relationship_manager —
// the Team Portal's Support Tickets Access Feature, gated for real by
// requireFeature('supportTickets') below and scoped in the controller to
// just an RM's own assigned agencies (assertOwnAgencyTicket). sales_manager
// deliberately stays excluded — Support Tickets isn't one of LM_FEATURE_KEYS.
router.use(requireAuth, requireRole('support', 'super_admin', 'relationship_manager'));
router.use(requireFeature('supportTickets'));

// Literal path before the :id routes — same ordering
// packageRequestsAdmin.routes.js already uses for its own
// lead-manager-candidates route, so Express never tries to match this
// against :id. Left support+super_admin-only in practice — an RM has
// nothing to assign a ticket *to* here (listAssignmentCandidates only ever
// returns support staff/super_admins), so this simply comes back a usable
// but pointless empty-ish dropdown for one rather than needing its own gate.
router.get('/assignment-candidates', ticketsAdminController.listAssignmentCandidates);

router.get('/', ticketsAdminController.listTickets);
router.get('/:id', ticketsAdminController.getTicket);
router.patch('/:id', validateBody(updateTicketSchema), ticketsAdminController.updateTicket);
router.post('/:id/messages', validateBody(ticketMessageSchema), ticketsAdminController.replyToTicket);

export default router;
