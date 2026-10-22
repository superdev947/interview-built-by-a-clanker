import { createRootRoute, Link, Outlet, useRouter } from "@tanstack/react-router";
import { useAuth } from "~/lib/auth";
import { useQuery } from "@tanstack/react-query";
import { api } from "~/lib/api";
import type { Cart } from "@acme/shared";

export const Route = createRootRoute({
  component: RootLayout,
  errorComponent: RootError,
});

function RootError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="max-w-lg mx-auto text-center py-24 px-4">
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Something went wrong</h1>
      <p className="text-gray-600 mb-6">{error.message}</p>
      <div className="flex justify-center gap-4">
        <button
          onClick={reset}
          className="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors"
        >
          Try again
        </button>
        <a href="/" className="px-4 py-2 text-indigo-600 hover:text-indigo-700">
          Back to browse
        </a>
      </div>
    </div>
  );
}

function RootLayout() {
  const { user, logout, isLoading: authLoading } = useAuth();
  const router = useRouter();

  const { data: cart } = useQuery({
    queryKey: ["cart"],
    queryFn: () => api.get<Cart>("/cart"),
    enabled: !!user,
  });

  const cartCount = cart?.items.reduce((sum, item) => sum + item.quantity, 0) ?? 0;

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-8">
              <Link to="/" className="flex items-center gap-2">
                <span className="text-2xl">🤖</span>
                <span className="text-xl font-bold text-gray-900">
                  Agentic Personas
                </span>
              </Link>
              <div className="hidden sm:flex items-center gap-4">
                <Link
                  to="/"
                  className="text-gray-600 hover:text-gray-900 px-3 py-2 text-sm font-medium transition-colors [&.active]:text-indigo-600"
                >
                  Browse
                </Link>
                {user && (
                  <Link
                    to="/favorites"
                    className="text-gray-600 hover:text-gray-900 px-3 py-2 text-sm font-medium transition-colors [&.active]:text-indigo-600"
                  >
                    Favorites
                  </Link>
                )}
              </div>
            </div>

            <div className="flex items-center gap-4">
              {authLoading ? (
                <div className="h-8 w-32 bg-gray-100 rounded-lg animate-pulse" />
              ) : user ? (
                <>
                  <Link
                    to="/cart"
                    className="relative text-gray-600 hover:text-gray-900 p-2 transition-colors"
                  >
                    <svg
                      className="w-6 h-6"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 100 4 2 2 0 000-4z"
                      />
                    </svg>
                    {cartCount > 0 && (
                      <span className="absolute -top-1 -right-1 bg-indigo-600 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                        {cartCount}
                      </span>
                    )}
                  </Link>
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-gray-600">
                      {user.username}
                    </span>
                    <button
                      onClick={() => {
                        logout();
                        router.navigate({ to: "/" });
                      }}
                      className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
                    >
                      Sign out
                    </button>
                  </div>
                </>
              ) : (
                <div className="flex items-center gap-3">
                  <Link
                    to="/login"
                    className="text-sm text-gray-600 hover:text-gray-900 transition-colors"
                  >
                    Sign in
                  </Link>
                  <Link
                    to="/register"
                    className="text-sm bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors"
                  >
                    Sign up
                  </Link>
                </div>
              )}
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {authLoading ? (
          <div className="animate-pulse h-96 bg-gray-100 rounded-xl" />
        ) : (
          <Outlet />
        )}
      </main>
    </div>
  );
}
