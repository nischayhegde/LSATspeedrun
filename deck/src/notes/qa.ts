/** Presenter Q&A grounded only in the original PPTX and its notes. */

export type QaTopic =
  | 'evidence'
  | 'ai'
  | 'gamification'
  | 'pedagogy'
  | 'product'
  | 'competitors'

export type QaEntry = {
  id: string
  question: string
  answer: string
  caveat?: string
  topics: QaTopic[]
  sources?: string[]
}

export const QA: readonly QaEntry[] = [
  {
    id: 'why-practice-first',
    question: 'Why center the product on questions instead of lessons?',
    answer:
      'Our original thesis is that LSAT students already have the general reading knowledge they need and improve by '
      + 'practicing test-taking strategies on real questions. Lawyer Tycoon therefore sends the student directly into '
      + 'a question, requires a written justification, and gives immediate feedback instead of building the experience '
      + 'around a video curriculum.',
    caveat:
      'Say that instruction is inefficient as the core of the experience. Do not claim that no student ever benefits from an explanation.',
    topics: ['pedagogy', 'product'],
  },
  {
    id: 'four-month-goal',
    question: 'Can you really cut four months of LSAT study in half?',
    answer:
      'Two months is our goal, not a measured outcome. The product is designed to put more of the same study time into '
      + 'targeted questions, written reasoning, and feedback, which is the mechanism we believe can shorten the path.',
    caveat: 'Always call two months the goal. Do not present it as a result from a completed learner study.',
    topics: ['evidence', 'product'],
  },
  {
    id: 'what-feedback-grades',
    question: 'What does the AI actually grade?',
    answer:
      'The student submits both an answer and a written explanation. An LLM follows a grading rubric, identifies what '
      + 'was correct or incorrect in the reasoning, and shows the proper reasoning for the problem.',
    topics: ['ai', 'product'],
  },
  {
    id: 'how-adaptive',
    question: 'What makes the practice adaptive?',
    answer:
      'The system uses past accuracy with spacing and interleaving. Question types a student misses appear more often, '
      + 'and strategies the student performs better with are prompted more often. The original product covered more '
      + 'than ten question-type buckets and fourteen high-yield strategies.',
    topics: ['pedagogy', 'product'],
  },
  {
    id: 'game-optional',
    question: 'Does a student have to use the game?',
    answer:
      'No. The adaptive question recommendation system works without the game. The tycoon loop is an optional '
      + 'motivation layer for students who want visible progress while they practice.',
    topics: ['gamification', 'product'],
  },
  {
    id: 'game-distracting',
    question: 'Does the game distract from studying?',
    answer:
      'The coupling only runs one way: practice advances the game, while the game never locks or replaces practice. '
      + 'Answering questions and mock exams earns the virtual currency used to expand the firm.',
    topics: ['gamification', 'product'],
  },
  {
    id: 'currency-evidence',
    question: 'What evidence supports virtual currency?',
    answer:
      'The evidence slide in the original deck cites Dicheva and colleagues: across three semester-long university '
      + 'studies, virtual currency raised out-of-class practice from 1.3 times to 3.7 times per student.',
    caveat: 'The measured outcome is practice participation. Do not turn it into a claim about LSAT-score gains.',
    topics: ['evidence', 'gamification'],
    sources: ['Dicheva et al. (2023), Trends in Higher Education 2(3)'],
  },
  {
    id: 'game-length',
    question: 'How long does it take to complete the game?',
    answer:
      'The original design target was about two months for a student answering twenty questions correctly each day. '
      + 'That is a pacing assumption for the progression system, not an observed completion rate.',
    topics: ['gamification', 'product'],
  },
  {
    id: 'mock-exams',
    question: 'Does the product include full practice exams?',
    answer:
      'Yes. Mock exams are available for students who can set aside the time, while the everyday loop remains focused '
      + 'on targeted questions and feedback.',
    topics: ['product'],
  },
  {
    id: 'why-better',
    question: 'What makes Lawyer Tycoon different from other LSAT apps?',
    answer:
      'The original pitch makes four points: we cut down the instructional bloat, keep one singular focus on practice, '
      + 'choose the next work for the student based on weakness, and use an optional game loop to motivate continued practice.',
    caveat:
      'Keep this at the level of the original positioning. Do not add prices, feature scorecards, or claims about named competitors.',
    topics: ['competitors', 'product'],
  },
]

export const QA_TOPICS: readonly QaTopic[] = Array.from(
  new Set(QA.flatMap((entry) => entry.topics)),
)
