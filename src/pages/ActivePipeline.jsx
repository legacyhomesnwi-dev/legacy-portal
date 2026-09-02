export default function ActivePipeline() {
  return (
    <div className="card placeholder">
      <span className="badge-soon">Coming soon</span>
      <h2>Active Pipeline</h2>
      <p>
        Every deal under contract, tracked from accepted offer to funded. This
        page will give the team one board to see what needs attention today.
      </p>
      <ul className="checklist">
        <li>Stages: Under Contract → Inspection → Title → Clear to Close → Funded</li>
        <li>Key dates: inspection deadline, closing date, earnest money</li>
        <li>Assigned acquisitions rep and transaction coordinator</li>
        <li>Blocking issues flagged with owner and due date</li>
        <li>Projected assignment fee vs. actual at close</li>
      </ul>
    </div>
  )
}
