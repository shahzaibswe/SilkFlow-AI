// src/components/chartSetup.js — register Chart.js pieces once, centrally.
import {
  Chart, DoughnutController, BarController, LineController,
  ArcElement, BarElement, LineElement, PointElement,
  CategoryScale, LinearScale, Tooltip, Legend, Filler,
} from 'chart.js'

Chart.register(
  DoughnutController, BarController, LineController,
  ArcElement, BarElement, LineElement, PointElement,
  CategoryScale, LinearScale, Tooltip, Legend, Filler,
)

Chart.defaults.font.family = "'Inter', ui-sans-serif, system-ui, sans-serif"
Chart.defaults.color = '#94a3b8'

export { Chart }
