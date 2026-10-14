import { Bar } from 'react-chartjs-2'
import './chartSetup'

// Horizontal bar chart of top feature reasons. Positive impact = green,
// negative = red. `features` = [{name,label,impact,direction}] per spec.
export function ReasonsBarChart({ features = [], height = 240 }) {
  const rows = features.slice(0, 6)
  if (!rows.length) {
    return <div className="flex h-32 items-center justify-center text-sm text-slate-500">No explanation data available</div>
  }

  const sorted = [...rows].sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact))
  const labels = sorted.map((f) => f.label || f.name)
  const values = sorted.map((f) => f.impact)
  const colors = values.map((v) => (v >= 0 ? 'rgba(52,211,153,0.85)' : 'rgba(248,113,113,0.85)'))

  const data = {
    labels,
    datasets: [
      {
        label: 'Impact on score',
        data: values,
        backgroundColor: colors,
        borderColor: values.map((v) => (v >= 0 ? '#34d399' : '#f87171')),
        borderWidth: 1,
        borderRadius: 5,
        barThickness: 16,
      },
    ],
  }

  const options = {
    indexAxis: 'y',
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (c) => `${c.raw > 0 ? '+' : ''}${c.raw} pts (${c.raw >= 0 ? 'increases' : 'decreases'} score)`,
        },
      },
    },
    scales: {
      x: {
        grid: { color: 'rgba(255,255,255,0.06)' },
        ticks: { callback: (v) => `${v > 0 ? '+' : ''}${v}` },
        title: { display: true, text: 'Impact on credit score (pts)', color: '#64748b', font: { size: 11 } },
      },
      y: { grid: { display: false }, ticks: { font: { size: 11 }, crossAlign: 'far' } },
    },
  }

  return (
    <div style={{ height }}>
      <Bar data={data} options={options} />
    </div>
  )
}

export default ReasonsBarChart
