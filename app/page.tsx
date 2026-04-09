export default function Home() {
  return (
    <main style={{ padding: "2rem", fontFamily: "sans-serif" }}>
      <h1>ACMP Control Board</h1>
      <p>Operationeel controle-dashboard bovenop AcMP</p>
      <nav>
        <ul>
          <li><a href="/dashboard">Office Dashboard</a></li>
          <li><a href="/planning">Shared Planning</a></li>
          <li><a href="/shop">Shop Wall Screen</a></li>
          <li><a href="/actions">Actions / Blockers</a></li>
          <li><a href="/backlog">Backlog</a></li>
          <li><a href="/capacity">Capaciteitsmanagement</a></li>
          <li><a href="/office-update">Office Update Form</a></li>
          <li><a href="/shop-update">Shop Update Form</a></li>
          <li><a href="/import">AcMP Import</a></li>
        </ul>
      </nav>
    </main>
  );
}
