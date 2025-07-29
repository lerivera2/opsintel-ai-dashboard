import { NextPage } from 'next';
import Head from 'next/head';
import dynamic from 'next/dynamic';
import { useState, useEffect } from 'react';

// Dynamically import the dashboard component to avoid SSR issues
const OpsIntelDashboard = dynamic(
  () => import('../components/OpsIntelDashboard'),
  {
    ssr: false,
    loading: () => (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-blue-900 to-gray-900 flex items-center justify-center">
        <div className="text-white text-xl">Loading OpsIntel Dashboard...</div>
      </div>
    )
  }
);

interface PageProps {}

const HomePage: NextPage<PageProps> = () => {
  const [mounted, setMounted] = useState(false);

  // Ensure component only renders on client side
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-blue-900 to-gray-900 flex items-center justify-center">
        <div className="text-white text-xl">Initializing...</div>
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>OpsIntel AI Dashboard - Manufacturing Intelligence</title>
        <meta 
          name="description" 
          content="Real-time manufacturing intelligence dashboard with AI-powered insights for operational optimization" 
        />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="index, follow" />
        <meta property="og:title" content="OpsIntel AI Dashboard" />
        <meta property="og:description" content="Manufacturing intelligence with AI insights" />
        <meta property="og:type" content="website" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="OpsIntel AI Dashboard" />
        <meta name="twitter:description" content="Real-time manufacturing intelligence" />
        <link rel="icon" href="/favicon.ico" />
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
        <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />
        <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png" />
      </Head>

      <main className="min-h-screen bg-gradient-to-br from-gray-900 via-blue-900 to-gray-900">
        <div className="container mx-auto px-4 py-8">
          <div className="max-w-7xl mx-auto">
            {/* Header Section */}
            <header className="text-center mb-8">
              <h1 className="text-4xl md:text-5xl font-bold text-white mb-4">
                OpsIntel AI Dashboard
              </h1>
              <p className="text-xl text-blue-200 max-w-2xl mx-auto">
                Real-time manufacturing intelligence powered by AI insights
              </p>
              <div className="mt-4 flex justify-center space-x-4 text-sm text-gray-300">
                <span className="flex items-center">
                  <div className="w-2 h-2 bg-green-400 rounded-full mr-2"></div>
                  Live Data
                </span>
                <span className="flex items-center">
                  <div className="w-2 h-2 bg-blue-400 rounded-full mr-2"></div>
                  AI Insights
                </span>
                <span className="flex items-center">
                  <div className="w-2 h-2 bg-purple-400 rounded-full mr-2"></div>
                  Real-time Updates
                </span>
              </div>
            </header>

            {/* Dashboard Component */}
            <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 shadow-2xl">
              <OpsIntelDashboard />
            </div>

            {/* Footer */}
            <footer className="text-center mt-8 text-gray-400 text-sm">
              <p>
                Powered by FRED Economic Data, EIA Energy Information, OpenWeather, and Claude AI
              </p>
              <p className="mt-2">
                © 2024 OpsIntel Dashboard. Built with Next.js and TypeScript.
              </p>
            </footer>
          </div>
        </div>
      </main>
    </>
  );
};

export default HomePage;