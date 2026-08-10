import { Clock3, Flag, TrendingDown } from 'lucide-react'

import type { ExamReport, ExamSectionReport } from './types'
import './exam-report.css'

/* What the last sitting produced, section by section.
 *
 * The selection is deliberate and short, because the dashboard is tab-organised
 * and a wall of numbers is a wall nobody reads. Four things are here, and each
 * one is here because it changes what a student does next:
 *
 *   Accuracy over the whole section, blanks included. Answering twelve of
 *   twenty-five perfectly is not a hundred per cent, and the number that says
 *   it is is the number that stops them fixing it. The answered-only rate sits
 *   underneath, because the gap between the two is the whole diagnosis: if they
 *   are close, the problem is knowing; if they are far apart, it is the clock.
 *
 *   How many were blank at the bell, and whether the bell is what ended the
 *   section. This is the pace measure that survived. "Seconds used against the
 *   limit" did not: on a timed section almost everyone uses all of it, so the
 *   number is 100% for nearly every student and tells them nothing.
 *
 *   Where inside the section it came apart, as the first half against the
 *   second. A student who is at eighty and then forty is not weak at reading;
 *   they are spending too long early, and that is a fixable habit rather than a
 *   skill gap. Both halves are scored over their own whole length so a collapse
 *   caused by running out of clock reads as a collapse.
 *
 *   Flagged and never returned to, as one line. It is small, but "I marked six
 *   to come back to and got to none of them" is a specific, correctable way to
 *   run a section.
 *
 * Rejected: a per-question time histogram, which is twenty-five bars a section
 * that answer a question the two halves already answer more usefully; and the
 * count of answers changed, which is interesting and not actionable — the
 * research on changing answers says do it, so a student cannot be told to do
 * less of it.
 */

function halfRate(half: { questions: number; correct: number }) {
  return half.questions ? Math.round((100 * half.correct) / half.questions) : null
}

function SectionRow({ section }: { section: ExamSectionReport }) {
  const opening = halfRate(section.opening)
  const closing = halfRate(section.closing)
  // Only called a falloff when it is one a student could act on. A couple of
  // questions' worth of drift is noise, and labelling noise trains people to
  // ignore the label.
  const falloff = opening != null && closing != null && opening - closing >= 15 ? opening - closing : null
  return (
    <li className="exam-report-row">
      <div className="exam-report-head">
        <div>
          <strong>{section.label}</strong>
          <small>
            {section.correct} of {section.questions}
            {section.answered_accuracy != null && section.answered < section.questions
              && ` · ${section.answered_accuracy}% of what you answered`}
          </small>
        </div>
        <b className={section.accuracy >= 70 ? 'is-strong' : section.accuracy >= 50 ? '' : 'is-weak'}>
          {section.accuracy}%
        </b>
      </div>

      <div className="exam-report-halves" aria-label={`First half ${opening ?? 0}%, second half ${closing ?? 0}%`}>
        <div><span style={{ width: `${opening ?? 0}%` }} /><small>First half {opening ?? 0}%</small></div>
        <div><span style={{ width: `${closing ?? 0}%` }} /><small>Second half {closing ?? 0}%</small></div>
      </div>

      <div className="exam-report-notes">
        {section.ran_out_of_time
          ? <span className="is-alert"><Clock3 size={13} /> Clock ran out with {section.unanswered} unanswered</span>
          : section.unanswered > 0
            ? <span><Clock3 size={13} /> Ended early with {section.unanswered} left blank</span>
            : <span><Clock3 size={13} /> Finished the section with time to spare</span>}
        {falloff != null && <span className="is-alert"><TrendingDown size={13} /> {falloff} points weaker in the second half</span>}
        {section.flagged_unanswered > 0 && <span><Flag size={13} /> {section.flagged_unanswered} flagged and never returned to</span>}
      </div>
    </li>
  )
}

export function ExamSectionReportPanel({ report }: { report: ExamReport }) {
  return (
    <section className="exam-report" aria-label="How the last form went, section by section">
      <div className="panel-heading">
        <div>
          <span>LAST FORM, SECTION BY SECTION</span>
          <h2>
            {report.sections_expired
              ? `The clock ended ${report.sections_expired} of your ${report.sections.length} sections.`
              : 'You finished every section before the bell.'}
          </h2>
        </div>
        <Clock3 />
      </div>
      <ul className="exam-report-list">
        {report.sections.map((section) => <SectionRow key={section.index} section={section} />)}
      </ul>
      <p className="exam-report-foot">
        Every rate counts the whole section, blanks included — a question left blank at the bell is a result,
        not a missing measurement.
      </p>
    </section>
  )
}
