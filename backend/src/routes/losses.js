import express from 'express';
import { requireRole, ROLE_GROUPS, PLATFORM_ADMINS } from '../middleware/auth.js';

const router = express.Router();

// Loss percentages feed energy accounting, so editing them is master-data write,
// not something any logged-in counterparty may do.
const LOSSES_READ = [...new Set([...ROLE_GROUPS.REIA_ALL, ...ROLE_GROUPS.TRADING_ALL, 'COMPLIANCE_AUDITOR'])];
// Masters are governance (Target #2 Phase B): a maker editing the losses it bills
// from is an SoD finding, so the administrators keep them; the desks read.
const LOSSES_WRITE = PLATFORM_ADMINS;

// Mock store for transmission losses
let lossesData = {
  regional: {
    NR: { injection: 0.00, drawal: 3.87 },
    WR: { injection: 0.00, drawal: 3.50 }
  },
  state: {
    HP: { injection: 0.75, drawal: 0.75 },
    UK: { injection: 1.20, drawal: 1.20 }
  },
  other: 0.33
};

router.get('/', requireRole(...LOSSES_READ), (req, res) => {
  res.json(lossesData);
});

// NOTE: lossesData is a module-level variable, so every edit made here is lost on
// the next restart and is not shared across processes. Before this drives any
// billing figure it needs to live in system_parameters like every other master.
router.post('/', requireRole(...LOSSES_WRITE), (req, res) => {
  const { regional, state, other } = req.body;
  if (regional) lossesData.regional = { ...lossesData.regional, ...regional };
  if (state) lossesData.state = { ...lossesData.state, ...state };
  if (other !== undefined) lossesData.other = other;
  
  res.json({ message: 'Loss configuration updated', data: lossesData });
});

export default router;
