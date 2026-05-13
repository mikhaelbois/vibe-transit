import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import SyncForm from '@/components/SyncForm';

describe('SyncForm', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders in ZIP mode by default', () => {
    render(<SyncForm />);
    // Drop zone text is visible
    expect(screen.getByText('Drop a GTFS .zip here')).toBeInTheDocument();
    // URL input is not present
    expect(screen.queryByPlaceholderText('https://example.com/gtfs.zip')).not.toBeInTheDocument();
  });

  it('switches to API mode when "API URL" button is clicked', () => {
    render(<SyncForm />);
    fireEvent.click(screen.getByRole('button', { name: 'API URL' }));
    expect(screen.getByPlaceholderText('https://example.com/gtfs.zip')).toBeInTheDocument();
    expect(screen.queryByText('Drop a GTFS .zip here')).not.toBeInTheDocument();
  });

  it('switches back to ZIP mode when "ZIP Upload" button is clicked after switching to API', () => {
    render(<SyncForm />);
    fireEvent.click(screen.getByRole('button', { name: 'API URL' }));
    fireEvent.click(screen.getByRole('button', { name: 'ZIP Upload' }));
    expect(screen.getByText('Drop a GTFS .zip here')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('https://example.com/gtfs.zip')).not.toBeInTheDocument();
  });

  it('shows loading state while fetch is in progress', async () => {
    // Use a promise that never resolves so we can inspect the loading state
    let resolveFetch!: (value: unknown) => void;
    const fetchPromise = new Promise(resolve => {
      resolveFetch = resolve;
    });
    globalThis.fetch = vi.fn().mockReturnValue(fetchPromise);

    render(<SyncForm />);

    // Switch to API mode and fill in a URL so the fetch actually fires
    fireEvent.click(screen.getByRole('button', { name: 'API URL' }));
    fireEvent.change(screen.getByPlaceholderText('https://example.com/gtfs.zip'), {
      target: { value: 'https://example.com/gtfs.zip' },
    });

    const syncButton = screen.getByRole('button', { name: 'Run Sync →' });
    fireEvent.click(syncButton);

    // Button should now show "Syncing..." and be disabled
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Syncing...' })).toBeDisabled();
    });

    // Clean up by resolving the promise
    resolveFetch({
      ok: true,
      json: async () => ({ rowsInserted: { stops: 0, routes: 0 } }),
    });
  });

  it('shows success result pill with counts after successful fetch', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ rowsInserted: { stops: 100, routes: 20 } }),
    });

    render(<SyncForm />);

    // Switch to API mode so we don't need to set a file
    fireEvent.click(screen.getByRole('button', { name: 'API URL' }));
    fireEvent.change(screen.getByPlaceholderText('https://example.com/gtfs.zip'), {
      target: { value: 'https://example.com/gtfs.zip' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Run Sync →' }));

    // Wait for the success message to appear
    const pill = await screen.findByText(/Synced:/);
    expect(pill).toBeInTheDocument();
    expect(pill.textContent).toContain('100');
    expect(pill.textContent).toContain('stops');
    expect(pill.textContent).toContain('20');
    expect(pill.textContent).toContain('routes');
  });

  it('shows error pill when fetch responds with ok: false', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Invalid ZIP' }),
    });

    render(<SyncForm />);

    fireEvent.click(screen.getByRole('button', { name: 'API URL' }));
    fireEvent.change(screen.getByPlaceholderText('https://example.com/gtfs.zip'), {
      target: { value: 'https://example.com/gtfs.zip' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Run Sync →' }));

    await screen.findByText(/Invalid ZIP/);
  });

  it('shows error pill when fetch throws an exception', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network failure'));

    render(<SyncForm />);

    fireEvent.click(screen.getByRole('button', { name: 'API URL' }));
    fireEvent.change(screen.getByPlaceholderText('https://example.com/gtfs.zip'), {
      target: { value: 'https://example.com/gtfs.zip' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Run Sync →' }));

    await screen.findByText(/Network failure/);
  });
});
