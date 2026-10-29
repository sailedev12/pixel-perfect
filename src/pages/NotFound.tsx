import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div className="page">
      <div className="eyebrow">404</div>
      <h1 className="page-title">Nothing here.</h1>
      <p className="muted">
        <Link to="/">Back to the games</Link>
      </p>
    </div>
  );
}
