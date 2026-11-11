# assess-oss

A skill for choosing open-source software with your coding agent.

Give it a GitHub repo, npm package, or Rust crate. Get a source-backed overview of what it does, its license,
popularity, and maintenance activity—without sending your agent through a maze of registry pages.

- **Assess a project** before trying it or adding a dependency.
- **Compare options** for your requirements, or find alternatives to something you already use.
- **Explore the people behind it:** their other projects and public contributions.

## Install

```sh
npx skills add asakin/assess-oss --skill assess-oss
```

Choose your agent when prompted. Requires Node.js 22.20 or newer.

## Ask your agent

- “Compare Zod and Valibot for validating a small browser app.”
- “Find alternatives to clap for a tiny Rust CLI.”
- “What else has @sindresorhus built?”
- “Look into the maintainers of this repo and their other open-source work.”

You can explicitly ask your agent to use **assess-oss**. Results include source links and dates so you can
check the evidence behind a recommendation.

## Use the CLI

You can also use assess-oss directly from a terminal. Install it from a source checkout:

```sh
git clone https://github.com/asakin/assess-oss.git
cd assess-oss
npm install --global .
```

```sh
assess-oss inspect npm:zod
assess-oss compare npm:express npm:fastify
assess-oss alternatives crate:clap --query "argument parser"
assess-oss profile @sindresorhus
assess-oss maintainers sindresorhus/slugify
```

Use a GitHub URL or `owner/repo`, `npm:package`, `crate:name`, or `@handle`. Add `--json` for structured
output, or run `assess-oss --help` for all commands and options.

For a project and its maintainer together, use `maintainers --person HANDLE`; no separate project/profile
calls are needed. Add `--no-readme` for compact output or `--details` for CI, tests, issue/PR, and dependency
signals.

## Optional Jev assessments

[Jev](https://docs.typesafe.ai/) can assess how well a project's documented capabilities fit your goal.
This integration is experimental. Regular project research works without a model account.

With a TypeSafe account, set `TYPESAFE_API_KEY` in your environment and run:

```sh
assess-oss inspect npm:zod --jev --goal "Validate incoming API data"
```

This sends the collected project documentation and your goal to TypeSafe. Add `--dry-run` to preview the
request without making a paid API call. Jev assessments are available for project inspection and comparison,
not people.

For agent-specific usage, see the [skill instructions](skills/assess-oss/SKILL.md).

---

[MIT license](LICENSE) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md)
