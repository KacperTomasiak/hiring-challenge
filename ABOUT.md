# ABOUT.md

## Why this role

This role interests me because the problem is real and the stakes are clear. I like building products where the challenge is not just generating an answer, but deciding whether that answer is trustworthy enough to act on. In a collections workflow, a wrong action is often worse than no action, so judgment, traceability, and failure handling matter as much as speed.

## How you work with AI tools

I use AI tools heavily, but not passively. They are useful for exploring approaches, stress-testing assumptions, drafting structure, and surfacing edge cases quickly. I do not outsource product judgment to them.

The line for me is simple: if a model output looks polished but is weak on correctness, provenance, or risk, I discard it and tighten the process. I trust AI most when I want breadth and acceleration. I trust myself most when the work depends on tradeoffs, ambiguity, and deciding what should happen when the evidence is incomplete.

## Last project: Hired3.com

- **One ambiguity you faced and how you resolved it:** A recurring question in Hired3 was how much structure and moderation to apply before a job went live. I wanted posting to feel fast, but I also knew low-quality or misleading listings would damage trust early. I resolved that by adding a more opinionated posting flow, using human review where needed, and shaping the UX to reward legitimate, repeat usage.
- **One tradeoff you made and why:** The main tradeoff was speed versus trust. I could have made posting and discovery looser to increase supply, but I chose to be more restrictive because early marketplace quality mattered more than top-line volume. I was willing to trade some growth and convenience for clearer listings, better moderation, and a more credible product.
- **One mistake you made and what you changed:** Early on, I overestimated how much a job board wins through supply alone. In practice, low-quality inventory drags down the whole experience, even when the numbers look better on paper. I changed that by being more selective about what gets surfaced and by treating marketplace quality as a core product feature.
- **One review comment that changed your mind:** The most useful feedback I got was that Hired3 was only interesting if it made Web3 hiring feel more direct, clear, and trustworthy, not if it became another broad jobs product. That pushed me to focus less on feature breadth and more on reducing wasted time between serious candidates and serious teams.

## Anything you'd improve about THIS challenge or our CLAUDE.md

The challenge is strong because it tests judgment, not just output. The main ambiguity I noticed was how to handle low-confidence rows: whether only `contact_email_or_phone` should be blanked below threshold, or whether all final contact fields should be blank in conflict cases. I made that decision explicitly in the implementation, but one additional sentence in the prompt would remove the ambiguity.
