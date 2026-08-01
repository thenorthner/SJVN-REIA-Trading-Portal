import express from 'express';

const router = express.Router();

function generateMockSchedule(date, portfolio) {
  const blocks = [];
  let currentMw = -17.1; // Starting with the user's example
  
  for (let i = 1; i <= 96; i++) {
    const startMins = (i - 1) * 15;
    const endMins = i * 15;
    const sh = Math.floor(startMins / 60).toString().padStart(2, '0');
    const sm = (startMins % 60).toString().padStart(2, '0');
    const eh = Math.floor(endMins / 60).toString().padStart(2, '0');
    const em = (endMins % 60).toString().padStart(2, '0');
    const timeLabel = `${sh}:${sm} - ${eh === '24' ? '24' : eh}:${em}`;

    let plantMw = 0;
    let regionalMw = 0;

    if (i >= 1 && i <= 18) {
       // Flat baseload / minimum environmental flow (Blocks 1-18)
       plantMw = -17.29;
       regionalMw = -17.10;
    } else if (i > 18 && i <= 48) {
       // Morning step up
       plantMw = -25.98;
       regionalMw = -25.70;
    } else if (i > 48 && i <= 64) {
       // Zero block / Idling / Conserving water
       plantMw = 0.0;
       regionalMw = 0.0;
    } else {
       // Evening generation
       plantMw = -15.57;
       regionalMw = -15.40;
    }

    const energyMwh = Number((plantMw / 4).toFixed(5));
    
    let jmrMw = plantMw;
    if (plantMw !== 0 && Math.random() > 0.8) {
        jmrMw = plantMw * (1 + (Math.random() * 0.1 - 0.05));
    }
    const deviationMw = Number((plantMw - jmrMw).toFixed(2));

    blocks.push({
      block_no: i,
      time_label: timeLabel,
      plant_mw: plantMw,
      regional_mw: regionalMw,
      buyer_mw: 0.0,
      scheduled_mwh: energyMwh,
      actual_jmr_mw: Number(jmrMw.toFixed(2)),
      deviation_mw: deviationMw
    });
  }
  
  return blocks;
}

router.get('/', (req, res) => {
  const { date = new Date().toISOString().split('T')[0], portfolio = 'N1HP0PTC0850' } = req.query;
  const data = generateMockSchedule(date, portfolio);
  res.json({ date, portfolio, blocks: data });
});

export default router;
