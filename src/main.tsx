import React from 'react';import{createRoot}from'react-dom/client';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';import{RouterApp}from'./ui';import'./style.css';import'./theme.css';
createRoot(document.getElementById('root')!).render(<React.StrictMode><QueryClientProvider client={new QueryClient()}><RouterApp/></QueryClientProvider></React.StrictMode>);
