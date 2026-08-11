# Repository history notes

Commits whose recorded message does not describe everything they changed. The
history is deliberately left alone — these commits are already published — so
this file is the record instead. If `git log` or `git blame` leads you to a
commit that does not seem to explain itself, search this file for its SHA.

## `55ea7ab` also carries a map revert

`55ea7ab` ("Carry the ordering result forward to the build that will deploy")
reads as a stylesheet-ordering QA commit, and its message describes only that:
re-anchoring the section 7 result against a build made at HEAD. It also
contains a change to `frontend/src/art/map-three-scene.tsx` that the message
never mentions.

That change is a revert of `4b430f1` ("Walk the village crowd along the
pavement that was laid, not past it"), committed about half an hour earlier.
`4b430f1` had made the village crowd in `addNationCorridor` follow the runs of
pavement the function actually lays, collected in a `paved` array, rather than
an unbroken 6.4 m polyline per town per side. `55ea7ab` restored the earlier
`townS.forEach` form and removed `paved`.

It happened because a `git revert --no-commit` of `4b430f1` was sitting staged
in the working tree while another worker committed the stylesheet result, so
the staged revert was swept into that commit.

The code is correct as it stands; the revert is the intended state and no
later commit reapplies `4b430f1`. Only the commit message is misleading, and
the fix for that is this note rather than a rewrite: `55ea7ab` is an ancestor
of `main`, `origin/main` and `integration/all-features`, so rewriting it would
break every checkout that already has it.
