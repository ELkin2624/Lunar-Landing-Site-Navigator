import ReactDOM from 'react-dom/client'
import App from './App'
import { LoadingProvider } from './LoadingContext'
import './styles.css'
import './theme.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <LoadingProvider>
    <App />
  </LoadingProvider>
)

