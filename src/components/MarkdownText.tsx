import React from 'react';
import { Text } from 'react-native';
import Markdown from 'react-native-markdown-display';
import { getTheme } from '../theme';
import { useTheme } from '../navigation/AppNavigator';

interface Props {
  children: string;
  color: string;
  fontSize?: number;
  lineHeight?: number;
  selectable?: boolean;
}

export default function MarkdownText({ children, color, fontSize = 15, lineHeight = 22, selectable }: Props) {
  const theme = getTheme(useTheme());
  const codeBg = theme.cardAlt;

  const rules = {
    text: (node: any, _children: any, _parent: any, styles: any) => (
      <Text key={node.key} style={[styles.text, { color, fontSize, lineHeight }]}>
        {node.content}
      </Text>
    ),
  };

  const mdStyles = {
    body: { color, fontSize, lineHeight },
    paragraph: { marginBottom: 8 },
    heading1: { fontSize: fontSize + 6, fontWeight: '700' as const, color, marginBottom: 6, marginTop: 4 },
    heading2: { fontSize: fontSize + 4, fontWeight: '700' as const, color, marginBottom: 6, marginTop: 4 },
    heading3: { fontSize: fontSize + 2, fontWeight: '600' as const, color, marginBottom: 4, marginTop: 4 },
    strong: { fontWeight: '700' as const, color },
    em: { fontStyle: 'italic' as const, color },
    code_inline: {
      fontFamily: 'monospace',
      fontSize: fontSize - 1,
      backgroundColor: codeBg,
      color,
      borderRadius: 4,
      paddingHorizontal: 4,
    },
    code_block: {
      fontFamily: 'monospace',
      fontSize: fontSize - 1,
      backgroundColor: codeBg,
      color,
      borderRadius: 8,
      padding: 12,
      marginVertical: 4,
    },
    fence: {
      fontFamily: 'monospace',
      fontSize: fontSize - 1,
      backgroundColor: codeBg,
      color,
      borderRadius: 8,
      padding: 12,
      marginVertical: 4,
    },
    bullet_list: { marginBottom: 4 },
    ordered_list: { marginBottom: 4 },
    list_item: { marginBottom: 2 },
    bullet_list_icon: { color, marginTop: lineHeight / 2 - 4 },
    ordered_list_icon: { color },
    blockquote: {
      borderLeftWidth: 3,
      borderLeftColor: color,
      paddingLeft: 12,
      opacity: 0.8,
      marginVertical: 4,
    },
    hr: { backgroundColor: color, opacity: 0.25, height: 1, marginVertical: 8 },
  };

  return (
    <Markdown style={mdStyles} rules={rules}>
      {children || ''}
    </Markdown>
  );
}
