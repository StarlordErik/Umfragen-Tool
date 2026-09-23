// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import HomePage from './page';

it('offers an accessible project entry and keyboard skip link', () => {
  render(<HomePage />);
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
    'Gemeinsam fragen.',
  );
  expect(
    screen.getByRole('link', { name: /Umfrage zum Oliven-Symposium/ }),
  ).toHaveAttribute('href', '/projects/olive-symposium');
  expect(
    screen.getByRole('link', { name: 'Zum Inhalt springen' }),
  ).toHaveAttribute('href', '#inhalt');
});
