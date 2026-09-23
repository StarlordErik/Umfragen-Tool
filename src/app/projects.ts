import { oliveSymposium } from '@/projects/olive-symposium/project';
import type { Project } from '@/shared/projects/project';

/** Composition root: projects know nothing about one another. Public metadata only. */
export const projects: readonly Project[] = [oliveSymposium];
