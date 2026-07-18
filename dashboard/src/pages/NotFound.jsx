import { Link } from 'react-router-dom'

export function NotFound() {
  return (
    <section className="state-block">
      <div>
        <h2>Page not found</h2>
        <p>The page you are looking for does not exist in the Warm Path Finder dashboard.</p>
        <Link className="button button-primary" to="/">Return to overview</Link>
      </div>
    </section>
  )
}
