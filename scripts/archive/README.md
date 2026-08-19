# Archived patch scripts

These are historical `apply_*.sh` heredoc scripts used to push feature
batches to the dev VM during earlier development. Each one embeds a full
snapshot of the files it touched at that point in time.

They're kept here for reference only and are not part of the build. Full
history is already preserved in git, so these are redundant with `git log`
and could be deleted entirely if repo size becomes a concern, especially
since this repo cross-publishes to the public mirror.

New one-off patch scripts should not be committed to the repo root going
forward.
