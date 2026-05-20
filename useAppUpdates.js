import { useEffect } from 'react';
import { Alert, Platform } from 'react-native';
import * as Updates from 'expo-updates';

export default function useAppUpdates() {
  useEffect(() => {
    // Only runs on real device builds, not in Expo Go or web
    if (Platform.OS === 'web') return;
    if (__DEV__) return;

    async function checkForUpdate() {
      try {
        const update = await Updates.checkForUpdateAsync();

        if (update.isAvailable) {
          Alert.alert(
            '🔄 Update Available',
            'A new version of DISS-Sync is ready. Update now for the latest features and fixes.',
            [
              {
                text: 'Later',
                style: 'cancel',
              },
              {
                text: 'Update Now',
                onPress: async () => {
                  try {
                    await Updates.fetchUpdateAsync();
                    await Updates.reloadAsync();
                  } catch (error) {
                    Alert.alert(
                      'Update Failed',
                      'Could not download the update. Please check your internet connection and try again.'
                    );
                  }
                },
              },
            ]
          );
        }
      } catch (error) {
        // Silently ignore — don't bother the user if update check fails
        console.log('Update check skipped:', error.message);
      }
    }

    checkForUpdate();
  }, []);
}