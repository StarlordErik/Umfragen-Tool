import { projectSchema } from '@/shared/projects/project';

export const oliveSymposium = projectSchema.parse({
  id: 'olive-symposium',
  title: 'Umfrage zum Oliven-Symposium',
  description:
    'Drei Perspektiven auf gutes Öl. Geschmack, Geruch und die ganze Erfahrung – gemeinsam verkosten und Ergebnisse entdecken.',
  category: 'Verkostung & Umfrage',
  href: '/projects/olive-symposium',
});
