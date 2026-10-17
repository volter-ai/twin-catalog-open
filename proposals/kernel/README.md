# Kernel proposals

A pack that needs a mechanism the platform's kernel lacks (a wire protocol, an authentication strategy, a way of
reading the vendor's state back, a screen behaviour) proposes it here; it never works around it in the pack. One pull
request per mechanism adds two files:

- `<mechanism>.md`: what the vendor needs, with its citation (`<url> "<the page's words>"`, as a pack cites any vendor
  fact); the paragraph the platform's [architecture](https://world-docs.volter.ai/docs/contributing/architecture) would
  take in the section that owns the mechanism, ending with a `First need:` line naming the pack and the vendor behaviour
  it serves; the pack's repository and the commit that builds on it.
- `<mechanism>.patch`: the change, as a patch of the released package it touches (`bun patch @volter/world-core`
  writes one), which the pack's repository applies while it is built.

Look at the open proposals first: when one already proposes the mechanism, build on it and name it in yours.

The catalog's automation reads a proposal as maintenance and runs nothing of it. A maintainer carries the mechanism
into the kernel and releases it, or answers the pull request with why not. The pack then pins that release, drops the
patch and is submitted ([the contributor guide](../../docs/contributing.md), "When the standard lacks a mechanism").
An admission never rests on an unreleased kernel.
