import express from 'express';

const router = express.Router();

function generateMockDOR(date, portfolio) {
  const blocks = [];
  let totalMwh = 0;
  let totalRevenue = 0;

  for (let i = 1; i <= 96; i++) {
    const startMins = (i - 1) * 15;
    const endMins = i * 15;
    const sh = Math.floor(startMins / 60).toString().padStart(2, '0');
    const sm = (startMins % 60).toString().padStart(2, '0');
    const eh = Math.floor(endMins / 60).toString().padStart(2, '0');
    const em = (endMins % 60).toString().padStart(2, '0');
    const timeLabel = `${sh}:${sm} - ${eh === '24' ? '24' : eh}:${em}`;

    let volumeMw = 0;
    
    // Simulate generation curve (Peaking Efficiency Strategy)
    if (i >= 1 && i <= 30) {
      volumeMw = -17.10; // Early morning
    } else if (i > 30 && i <= 48) {
      volumeMw = -25.70; // Step up before afternoon
    } else if (i >= 49 && i <= 64) {
      volumeMw = 0.0; // Conserving water (12:00 PM to 04:00 PM)
    } else {
      volumeMw = -12.80; // Late evening
    }

    // Simulate MCP (Even during 0.0 MW blocks)
    let mcp = 2300.34;
    if (i > 30 && i <= 50) mcp = 3727.02;
    
    // Evening peak hits price cap
    if (i >= 69 && i <= 72) { // 17:15 - 18:15 approx
      mcp = 10000.00;
    }

    const mwh = Number((Math.abs(volumeMw) / 4).toFixed(5));
    const tradeValue = Number((mwh * mcp).toFixed(2));

    totalMwh += mwh;
    totalRevenue += tradeValue;

    blocks.push({
      block_no: i,
      time_label: timeLabel,
      volume_mw: volumeMw, // Keep negative sign for seller injection
      mcp: mcp,
      trade_value: volumeMw === 0 ? 0.0 : tradeValue
    });
  }
  
  return {
    date,
    portfolio,
    blocks,
    summary: {
      total_mwh: Number(totalMwh.toFixed(5)),
      total_revenue: 1321932.90, // Hardcoded for screenshot replica
      weighted_avg_rate: totalMwh > 0 ? Number((1321932.90 / totalMwh).toFixed(2)) : 0
    },
    financial_summary: {
      gross_revenue: 1321932.90,
      nldc_fee: 7.56,
      ctu_charges: 0.00,
      stu_charges: 24289.07,
      sldc_charges: 2000.00,
      iex_fees: 7175.50,
      igst: 1291.59,
      net_payout: 1287169.18,
      is_discrepancy: false
    },
    signatory: {
      name: "Amit Kumar",
      designation: "Sr VP Market Operations"
    }
  };
}

router.get('/', (req, res) => {
  const { date = new Date().toISOString().split('T')[0], portfolio = 'PTC0850_HP0_Naitwar_Mori_HPS' } = req.query;
  const data = generateMockDOR(date, portfolio);
  res.json(data);
});

export default router;
