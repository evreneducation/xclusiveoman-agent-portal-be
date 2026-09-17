const {
  Router
} = require('express');

const ticketsController = require('../controllers/supportTicketsAgent.controller.js');

const {
  requireAuth,
  requireRole
} = require('../middleware/auth.js');

const {
  validateBody,
  createTicketSchema,
  ticketMessageSchema
} = require('../validation/schemas.js');

const router = Router();

// Agent Support & Helpdesk (Task 18 — Screen 27, SUP-1/SUP-3). Mounted at
// /api/support/tickets — same existing agency_owner/agency_staff gate every
// other agent-facing router in this codebase uses.
router.use(requireAuth, requireRole('agency_owner', 'agency_staff'));

router.get('/', ticketsController.listMyTickets);
router.post('/', validateBody(createTicketSchema), ticketsController.createMyTicket);
router.post('/:id/messages', validateBody(ticketMessageSchema), ticketsController.replyToMyTicket);

module.exports = router;
