import { Doughnut } from 'react-chartjs-2'
import './chartSetup'
import { BAND_META } from '../utils'

// Doughnut 0-100 trade credit score with band color + center readout.
export function ScoreGauge({ score, band, size = 180 }) {
  const val = score == null ? 0 : Math.max(0, Math.min(100, score))
  const b = band || (val >= 70 ? 'low' : val >= 50 ? 'medium' : 'high')
  const color = BAND_META[b]?.ring || '#64748b'
  const has = score != null

  const data = {
    datasets: [
      {
        data: has ? [val, 100 - val] : [1, 99],
        backgroundColor: has ? [color, 'rgba(255,255,255,0.06)'] : ['rgba(255,255,255,0.06)', 'rgba(255,255,255,0.06)'],
        borderWidth: 0,
        borderRadius: has ? 8 : 0,
      },
    ],
  }

  const options = {
    cutout: '76%',
    responsive: true,
    maintainAspectRatio: false,
    rotation: -120,
    circumference: 240,
    plugins: { legend: { display: false }, tooltip: { enabled: false } },
    animation: { animateRotate: true, duration: 900 },
  }

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <Doughnut data={data} options={options} />
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-4xl font-extrabold tabular-nums text-white">{has ? Math.round(val) : '—'}</span>
        <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: has ? color : '#64748b' }}>
          {has ? `${BAND_META[b]?.label} risk` : 'Unrated'}
        </span>
      </div>
    </div>
  )
}

export default ScoreGauge
