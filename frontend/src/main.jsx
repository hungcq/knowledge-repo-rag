import React from "react";
import ReactDOM from "react-dom/client";
import 'antd/dist/reset.css';
import ChatApp from "./App";
import { App as AntApp, ConfigProvider, theme } from 'antd';
import 'antd/dist/reset.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <ConfigProvider theme={{ algorithm: theme.darkAlgorithm }}>
    <AntApp>
      <ChatApp />
    </AntApp>
  </ConfigProvider>
);