# Product scope

## User flow

1. The user creates an account or signs in.
2. The user starts practice.
3. The app presents questions randomly selected from the Hugging Face LSAT LR and RC datasets.
4. After each answer, the verified key determines correctness and the LLM grades any written reasoning and explains every choice.

## Explicit non-goals

- No onboarding questionnaire or diagnostic
- No adaptive, mastery-based, spaced-repetition, or learning-science sequencing
- No narrative, characters, game progression, XP, bosses, or story scenes
- No model-selected question order

Question selection is a uniform random sample without replacement within a session. Performance may be stored for session summaries, but it never affects question selection.
