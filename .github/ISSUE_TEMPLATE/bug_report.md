---

name: Bug report
about: Report a bug or unexpected behavior
title: "[BUG] "
labels: bug
---

## Description

<!-- Describe the bug. -->

## Steps to reproduce

1.
2.
3.

## Expected behavior

<!-- Describe what you expected to happen. -->

## Actual behavior

<!-- Describe what happened. -->

## Environment

- **OS**: <!-- e.g. macOS 15, Ubuntu 24.04, Windows 11 -->
- **Yarn and Node.js versions**: <!-- yarn --version, and node --version -->
- **Plugin version**: <!-- from the plugins entry in .yarnrc.yml -->
- **Cloudsmith CLI version**: <!-- cloudsmith --version -->

## Diagnostics

<!--
Paste the output of these commands:

  1. Which hosts does the CLI report?
       cloudsmith domains list

  2. Does the CLI have a credential? (Do not paste the token.)
       cloudsmith credential-helper generic > /dev/null && echo ok

  3. Which plugins does Yarn load, and what does the install print?
       yarn plugin runtime
       yarn install 2>&1 | grep -i cloudsmith
-->

```
paste output here
```

## Additional context

<!-- Add any other context. -->
