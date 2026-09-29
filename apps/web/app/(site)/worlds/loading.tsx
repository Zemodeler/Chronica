/** The worlds page's shape while the catalogue is read: the heading and the leading plate. */
export default function WorldsLoading() {
  return (
    <main id="main-content" className="worlds-page" aria-busy="true" aria-label="Loading the worlds">
      <header className="worlds-page__head">
        <h1>Worlds</h1>
        <p>Each world begins on a particular day and waits for you. Choose one, then decide who you will be in it.</p>
      </header>
      <div className="skeleton world-lead world-lead--skeleton" />
    </main>
  );
}
