// lazy / keepAlive 조합이 실제로 어떤 페이지를 마운트하는지 검증하는 테스트
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import React from 'react';
import { View } from 'react-native';
import { act, create } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';

jest.mock('react-native-screens', () => {
  const ReactModule = require('react');

  return {
    ScreenContainer: ({ children }: { children: React.ReactNode }) =>
      ReactModule.createElement('ScreenContainer', null, children),
    Screen: ReactModule.forwardRef(
      (props: Record<string, unknown>, ref: React.Ref<unknown>) =>
        ReactModule.createElement('NativeScreen', { ...props, ref })
    ),
  };
});

import FastPager from '../FastPager';

const mounted: string[] = [];

const Page = ({ name }: { name: string }) => {
  React.useEffect(() => {
    mounted.push(name);
  }, [name]);
  return <View testID={`page-${name}`} />;
};

const pages = () => [
  <Page key="a" name="a" />,
  <Page key="b" name="b" />,
  <Page key="c" name="c" />,
];

const measure = (renderer: ReactTestRenderer, width: number) => {
  const container = renderer.root.findAll(
    (node) => typeof node.props?.onLayout === 'function'
  )[0];
  expect(container).toBeDefined();

  act(() => {
    container!.props.onLayout({
      nativeEvent: { layout: { width, height: 200 } },
    });
  });
};

describe('FastPager mounting', () => {
  let renderer: ReactTestRenderer;

  beforeAll(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    mounted.length = 0;
  });

  afterEach(() => {
    act(() => {
      renderer?.unmount();
    });
  });

  it('mounts only the page it starts on by default', () => {
    act(() => {
      renderer = create(
        <FastPager index={0} layout={{ width: 100 }}>
          {pages()}
        </FastPager>
      );
    });

    expect(mounted).toEqual(['a']);
  });

  it('mounts every page up front when lazy is false', () => {
    act(() => {
      renderer = create(
        <FastPager index={0} lazy={false} layout={{ width: 100 }}>
          {pages()}
        </FastPager>
      );
    });

    expect(mounted).toEqual(['a', 'b', 'c']);
  });

  it('holds pages back until the container has been measured', () => {
    act(() => {
      renderer = create(
        <FastPager index={0} lazy={false}>
          {pages()}
        </FastPager>
      );
    });

    // The page on screen owns the layout and mounts either way; the ones
    // parked off screen wait so they never lay out at an unsettled size.
    expect(mounted).toEqual(['a']);

    measure(renderer, 100);

    expect(mounted).toEqual(['a', 'b', 'c']);
  });

  it('keeps mounting on first visit when keepAlive is set', () => {
    act(() => {
      renderer = create(
        <FastPager index={0} lazy={false} keepAlive={2} layout={{ width: 100 }}>
          {pages()}
        </FastPager>
      );
    });

    expect(mounted).toEqual(['a']);
  });

  it('mounts a page the index prop moves to', () => {
    act(() => {
      renderer = create(
        <FastPager index={0} layout={{ width: 100 }}>
          {pages()}
        </FastPager>
      );
    });
    expect(mounted).toEqual(['a']);

    act(() => {
      renderer.update(
        <FastPager index={1} layout={{ width: 100 }}>
          {pages()}
        </FastPager>
      );
    });

    expect(mounted).toEqual(['a', 'b']);
  });
});
