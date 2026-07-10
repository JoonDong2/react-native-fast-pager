import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Animated,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import FastPager from 'react-native-fast-pager';

// ─── Mock Data ──────────────────────────────────────────────────────────────

const RECIPE = {
  title: 'Creamy Garlic Butter Tuscan Shrimp',
  channel: 'Chef Marco',
  thumbnail: 'https://picsum.photos/seed/recipe/800/450',
  channelAvatar: 'https://picsum.photos/seed/chef/100/100',
  estimatedTime: '25 min',
  viewCount: '1.2M views',
};

const INGREDIENTS = [
  { name: 'Shrimp (peeled & deveined)', amount: '500g' },
  { name: 'Heavy cream', amount: '240ml' },
  { name: 'Parmesan cheese', amount: '60g' },
  { name: 'Sun-dried tomatoes', amount: '80g' },
  { name: 'Garlic (minced)', amount: '4 cloves' },
  { name: 'Fresh spinach', amount: '150g' },
  { name: 'Butter', amount: '2 tbsp' },
  { name: 'Olive oil', amount: '1 tbsp' },
  { name: 'Italian seasoning', amount: '1 tsp' },
  { name: 'Salt & pepper', amount: 'to taste' },
  { name: 'Red pepper flakes', amount: '1/4 tsp' },
  { name: 'Chicken broth', amount: '120ml' },
  { name: 'Lemon juice', amount: '1 tbsp' },
  { name: 'Fresh basil', amount: '10 leaves' },
  { name: 'Onion (diced)', amount: '1 medium' },
  { name: 'White wine', amount: '60ml' },
  { name: 'Cherry tomatoes', amount: '200g' },
  { name: 'Capers', amount: '1 tbsp' },
  { name: 'Anchovy paste', amount: '1 tsp' },
  { name: 'Pine nuts (toasted)', amount: '30g' },
  { name: 'Dried oregano', amount: '1/2 tsp' },
  { name: 'Crushed garlic', amount: '2 cloves' },
  { name: 'Bay leaves', amount: '2' },
  { name: 'Cornstarch slurry', amount: '1 tbsp' },
];

const STEPS = [
  {
    time: '0:00',
    text: 'Pat shrimp dry, season with salt, pepper, and Italian seasoning.',
  },
  {
    time: '1:30',
    text: 'Heat olive oil and 1 tbsp butter in a large skillet over medium-high heat.',
  },
  {
    time: '3:00',
    text: 'Sear shrimp 2 minutes per side until pink. Remove and set aside.',
  },
  { time: '4:30', text: 'Dice the onion finely and mince the garlic cloves.' },
  {
    time: '6:00',
    text: 'Add remaining butter and sauté onion until translucent, about 3 minutes.',
  },
  {
    time: '7:00',
    text: 'Add minced garlic and anchovy paste, cook for 30 seconds until fragrant.',
  },
  {
    time: '7:30',
    text: 'Deglaze with white wine, scraping up any browned bits from the bottom.',
  },
  {
    time: '9:00',
    text: 'Add sun-dried tomatoes and cherry tomatoes. Cook for 2 minutes.',
  },
  {
    time: '10:00',
    text: 'Pour in heavy cream and chicken broth. Stir well and bring to a simmer.',
  },
  {
    time: '11:00',
    text: 'Add bay leaves and dried oregano. Let simmer for 3 minutes.',
  },
  {
    time: '13:00',
    text: 'Add parmesan cheese, stir until melted and sauce thickens slightly.',
  },
  {
    time: '14:00',
    text: 'If sauce is too thin, stir in cornstarch slurry and cook for 1 minute.',
  },
  {
    time: '15:00',
    text: 'Add spinach and capers. Cook until spinach is wilted, about 2 minutes.',
  },
  {
    time: '17:00',
    text: 'Return shrimp to the skillet. Toss gently to coat with sauce.',
  },
  {
    time: '18:00',
    text: 'Remove bay leaves. Squeeze lemon juice over the dish.',
  },
  {
    time: '19:00',
    text: 'Garnish with fresh basil, toasted pine nuts, and red pepper flakes.',
  },
  { time: '20:00', text: 'Let rest for 2 minutes so flavors meld together.' },
  {
    time: '22:00',
    text: 'Plate over pasta or alongside crusty bread. Finish with extra parmesan.',
  },
  {
    time: '23:00',
    text: 'Drizzle with a touch of olive oil for presentation.',
  },
  {
    time: '24:00',
    text: 'Serve immediately while hot. Pairs well with a crisp white wine.',
  },
];

// ─── Sub-pages for FastPager ────────────────────────────────────────────────

function IngredientsScreen({ minHeight }: { minHeight: number }) {
  return (
    <View style={[styles.tabContent, { minHeight }]}>
      <View style={styles.servingsRow}>
        <Text style={styles.servingsLabel}>2 servings</Text>
      </View>
      {INGREDIENTS.map((item, i) => (
        <View key={i} style={styles.ingredientRow}>
          <Text style={styles.ingredientName}>{item.name}</Text>
          <Text style={styles.ingredientAmount}>{item.amount}</Text>
        </View>
      ))}
    </View>
  );
}

function StepsScreen({ minHeight }: { minHeight: number }) {
  return (
    <View style={[styles.tabContent, { minHeight }]}>
      {STEPS.map((step, i) => (
        <View key={i} style={styles.stepRow}>
          <View style={styles.stepNumber}>
            <Text style={styles.stepNumberText}>{i + 1}</Text>
          </View>
          <View style={styles.stepBody}>
            <Text style={styles.stepTime}>{step.time}</Text>
            <Text style={styles.stepText}>{step.text}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

// ─── Tab Bar (sticky) ───────────────────────────────────────────────────────

const TABS = ['Ingredients', 'Steps'];

function TabBar({
  index,
  progress,
  onPress,
}: {
  index: number;
  progress: Animated.Value;
  onPress: (i: number) => void;
}) {
  const { width } = useWindowDimensions();
  const tabWidth = width / TABS.length;

  const indicatorTranslateX = progress.interpolate({
    inputRange: TABS.map((_, i) => i),
    outputRange: TABS.map((_, i) => i * tabWidth),
    extrapolate: 'clamp',
  });

  return (
    <View style={styles.tabBar}>
      {TABS.map((label, i) => (
        <Pressable
          key={label}
          style={styles.tabItem}
          onPress={() => onPress(i)}
        >
          <Text style={[styles.tabLabel, i === index && styles.tabLabelActive]}>
            {label}
          </Text>
        </Pressable>
      ))}
      <Animated.View
        style={[
          styles.tabIndicator,
          { width: tabWidth, transform: [{ translateX: indicatorTranslateX }] },
        ]}
      />
    </View>
  );
}

// ─── Header section (above sticky tab) ─────────────────────────────────────

function HeaderSection() {
  return (
    <View style={styles.header}>
      <Image source={{ uri: RECIPE.thumbnail }} style={styles.thumbnail} />
      <View style={styles.metaRow}>
        <Image source={{ uri: RECIPE.channelAvatar }} style={styles.avatar} />
        <Text style={styles.channelName}>{RECIPE.channel}</Text>
      </View>
      <Text style={styles.title}>{RECIPE.title}</Text>
      <View style={styles.statsRow}>
        <Text style={styles.stat}>{RECIPE.estimatedTime}</Text>
        <Text style={styles.statDot}>·</Text>
        <Text style={styles.stat}>{RECIPE.viewCount}</Text>
      </View>
    </View>
  );
}

// ─── Main App ───────────────────────────────────────────────────────────────

const ITEMS = ['header', 'tab', 'pager'] as const;

export default function App() {
  const [tabIndex, setTabIndex] = useState(0);
  const progress = useRef(new Animated.Value(0)).current;
  const { height: screenHeight } = useWindowDimensions();
  const flatlistRef = useRef<FlatList>(null);
  const onProgressChange = useMemo(
    () =>
      Animated.event([{ nativeEvent: { progress } }], {
        useNativeDriver: true,
      }),
    [progress]
  );

  // Approximate content min height so FastPager fills remaining space
  const contentMinHeight = screenHeight - 48; // tab height

  const onIndexChange = useCallback((index: number) => {
    setTabIndex(index);
    // Scroll to bring the pager area into view
    setTimeout(() => {
      flatlistRef.current?.scrollToIndex({ index: 2, viewOffset: 48 });
    }, 250);
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: (typeof ITEMS)[number] }) => {
      switch (item) {
        case 'header':
          return <HeaderSection />;
        case 'tab':
          return (
            <TabBar
              index={tabIndex}
              progress={progress}
              onPress={onIndexChange}
            />
          );
        case 'pager':
          return (
            <FastPager
              index={tabIndex}
              onIndexChange={onIndexChange}
              onProgressChange={onProgressChange}
            >
              <IngredientsScreen minHeight={contentMinHeight} />
              <StepsScreen minHeight={contentMinHeight} />
            </FastPager>
          );
      }
    },
    [tabIndex, progress, onProgressChange, onIndexChange, contentMinHeight]
  );

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <FlatList
        ref={flatlistRef}
        data={ITEMS as unknown as (typeof ITEMS)[number][]}
        renderItem={renderItem}
        keyExtractor={(item) => item}
        stickyHeaderIndices={[1]}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },

  // Header
  header: {
    backgroundColor: '#fff',
    paddingBottom: 16,
  },
  thumbnail: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: '#ddd',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#ccc',
    marginRight: 8,
  },
  channelName: {
    fontSize: 13,
    color: '#666',
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: '#111',
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 6,
  },
  stat: {
    fontSize: 12,
    color: '#999',
  },
  statDot: {
    fontSize: 12,
    color: '#ccc',
    marginHorizontal: 6,
  },

  // Tab bar
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e0e0e0',
    position: 'relative',
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 14,
  },
  tabLabel: {
    fontSize: 15,
    fontWeight: '500',
    color: '#999',
  },
  tabLabelActive: {
    color: '#111',
    fontWeight: '600',
  },
  tabIndicator: {
    position: 'absolute',
    bottom: 0,
    height: 2,
    backgroundColor: '#111',
  },

  // Tab content (Ingredients / Steps)
  tabContent: {
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 40,
  },

  // Ingredients
  servingsRow: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: '#f8f8f8',
    borderRadius: 8,
    marginBottom: 12,
  },
  servingsLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
  ingredientRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eee',
  },
  ingredientName: {
    fontSize: 15,
    color: '#333',
    flex: 1,
  },
  ingredientAmount: {
    fontSize: 15,
    color: '#888',
    marginLeft: 16,
  },

  // Steps
  stepRow: {
    flexDirection: 'row',
    marginBottom: 20,
  },
  stepNumber: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#111',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    marginTop: 2,
  },
  stepNumberText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#fff',
  },
  stepBody: {
    flex: 1,
  },
  stepTime: {
    fontSize: 12,
    color: '#999',
    marginBottom: 4,
  },
  stepText: {
    fontSize: 15,
    color: '#333',
    lineHeight: 22,
  },
});
