# NIPT CBH

## Platform
Web application used from desktop and mobile browsers on a hospital LAN.

## Stack
Owner-selected Next.js 16 / React 19 / TypeScript, Tailwind CSS 4 at build time, self-hosted PostgreSQL, Node worker, isolated Chromium renderer and Docker/OCI. Application is at repository root. All assets are local.

## Users and task
ANC and laboratory staff share one case registry. A redraw keeps the existing LN and receives a new specimen round locally; a repeat creates an attempt on the same specimen. Admin manages users, operational settings and system health without implicit clinical permissions. Thai is the primary interface language.

## Current release
P1 foundation uses only generated synthetic data. No live HIS, actual patients, historical promotion, clinical certification or release. Original legacy archives supply the compatibility reference and are never a separate runtime.

## Success
Preserve the working PET/OK and RES/OK/PDF protocol. Avoid duplicate entry and extra workflow steps. Enforce AL-1 and OD-24 UQ-1–UQ-11. Later clinical, integration and human acceptance gates remain open.

## Design assumptions
Inferred from the approved operational brief: staff usually work under normal office/laboratory lighting; use a light surface, explicit status text and large controls. This is an implementation choice, not a claimed ANC/Lab usability approval.
