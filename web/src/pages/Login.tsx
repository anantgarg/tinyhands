import { Button } from '@/components/ui/button';

export function Login() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-warm-bg p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <img src="https://avatars.slack-edge.com/2026-03-12/10669603251543_4076da95a48800f96b7c_512.png" alt="TinyHands" className="mx-auto h-16 w-16 rounded-2xl" />
          <h1 className="mt-4 text-[28px] font-extrabold text-warm-text tracking-tight">TinyHands</h1>
          <p className="mt-1 text-warm-text-secondary">AI Agent Platform for Slack</p>
        </div>

        <div className="rounded-card border border-warm-border bg-white p-8">
          <Button
            className="w-full h-11"
            onClick={() => {
              window.location.href = '/api/v1/auth/slack';
            }}
          >
            <svg className="mr-2 h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zm0 1.271a2.527 2.527 0 0 1 2.521 2.521 2.527 2.527 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zm10.124 2.521a2.528 2.528 0 0 1 2.52-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.52V8.834zm-1.271 0a2.527 2.527 0 0 1-2.521 2.521 2.527 2.527 0 0 1-2.521-2.521V2.522A2.528 2.528 0 0 1 15.165 0a2.528 2.528 0 0 1 2.522 2.522v6.312zm-2.522 10.124a2.528 2.528 0 0 1 2.522 2.52A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.521-2.522v-2.52h2.521zm0-1.271a2.527 2.527 0 0 1-2.521-2.521 2.528 2.528 0 0 1 2.521-2.521h6.313A2.528 2.528 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.522h-6.313z" />
            </svg>
            Sign in with Slack
          </Button>
          <p className="mt-4 text-center text-xs text-warm-text-secondary">
            Sign in with your Slack workspace to access the dashboard.
          </p>
        </div>
      </div>
    </div>
  );
}
