import express from 'express';

const router = express.Router();

function generateMockArchives(portfolio) {
  const archives = [];
  const today = new Date();
  
  for (let i = 0; i < 30; i++) {
    const deliveryDate = new Date(today);
    deliveryDate.setDate(today.getDate() - i);
    
    const tradeDate = new Date(deliveryDate);
    tradeDate.setDate(deliveryDate.getDate() - 1);
    
    const ddTrade = tradeDate.getDate().toString().padStart(2, '0');
    const mmTrade = (tradeDate.getMonth() + 1).toString().padStart(2, '0');
    const yyTrade = tradeDate.getFullYear().toString().slice(-2);
    
    const ddDel = deliveryDate.getDate().toString().padStart(2, '0');
    const mmDel = (deliveryDate.getMonth() + 1).toString().padStart(2, '0');
    const yyDel = deliveryDate.getFullYear().toString().slice(-2);
    
    // IEX231127SCH_PTC0850_HP0_Naitwar_Mori_HPS.xlsx
    const filename = `IEX${yyDel}${mmDel}${ddDel}SCH_PTC0850_HP0_Naitwar_Mori_HPS.xlsx`;
    
    let status = 'PARSED';
    if (i === 0) status = 'PENDING';
    if (i === 5) status = 'SUPERSEDED';

    let settlement_status = 'FULLY_RECONCILED';
    if (i === 0) settlement_status = 'PENDING_PAYOUT';
    if (i === 2) settlement_status = 'DISCREPANCY';

    // Mock 96 blocks for preview
    const blocks = [];
    for(let b=1; b<=96; b++) {
      let mw = 0;
      if (b <= 18) mw = -17.29;
      else if (b > 18 && b <= 48) mw = -25.98;
      else if (b > 48 && b <= 64) mw = 0.0;
      else mw = -15.57;
      blocks.push(mw);
    }

    archives.push({
      id: `arch-${i}`,
      portfolio_id: portfolio,
      trade_date: `${tradeDate.getFullYear()}-${mmTrade}-${ddTrade}`,
      delivery_date: `${deliveryDate.getFullYear()}-${mmDel}-${ddDel}`,
      filename,
      status,
      settlement_status,
      blocks
    });
  }
  return archives;
}

router.get('/', (req, res) => {
  const { portfolio = 'N1HP0PTC0850' } = req.query;
  res.json({ archives: generateMockArchives(portfolio) });
});

export default router;
