import type { NextApiRequest, NextApiResponse } from 'next'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // TODO: fetch from /api/fred, /api/eia, /api/weather, /api/insight
  res.status(200).json({
    production: { index: 102.4, trend: '↑ 0.5% MoM' },
    energy: { centsPerKwh: 9.1, trend: '→ stable' },
    weather: { temp: 104, alert: 'Heat wave warning' },
    insight: {
      summary: 'Energy cost spike + heatwave',
      recommendation: 'Shift ops to off-peak hours'
    }
  });
}
