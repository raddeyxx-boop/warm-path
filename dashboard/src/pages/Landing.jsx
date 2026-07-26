import { useNavigate } from 'react-router-dom'
import { LoginPresentation } from '../components/login/LoginPresentation'

export function Landing() {
  const navigate = useNavigate()

  return (
    <>
      <div className="presentation-top-actions">
        <button type="button" className="button futuristic-action futuristic-action--compact landing-sign-in" onClick={() => navigate('/login')}>
          <span>Sign In</span>
        </button>
      </div>
      <main className="auth-page-welcome landing-page">
        <LoginPresentation onReturnToLogin={() => navigate('/login')} />
      </main>
    </>
  )
}
